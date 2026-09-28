import { describe, expect, it } from 'vitest';
import {
  buildReadingMessages,
  buildInterpretationPrompt,
  buildFollowUpDirectPrompt,
  buildFollowUpWithExtrasPrompt,
  buildFollowUpDecidePrompt,
  buildDailyInterpretationPrompt,
} from '@/lib/api/prompts';
import { getSpreadById } from '@/lib/tarot/spreads';
import { allCards } from '@/lib/tarot/cards';
import type { DrawnCard } from '@/lib/tarot/types';

const spread = getSpreadById('single')!;
const cards: DrawnCard[] = [{ card: allCards[0], position: spread.positions[0], isReversed: true }];
const history = [
  {
    question: '我们已约好周五见面',
    interpretation: '<think>隐藏历史思考</think>讨论见面',
    additionalCards: cards,
  },
];

describe('解读输出提示', () => {
  it('separates stable instructions from the exact user context across reading modes', () => {
    const question = 'A税后8000，B税后5000，必要开支6000。我只想先稳定收支。';
    for (const prompt of [
      buildInterpretationPrompt(question, spread, cards),
      buildFollowUpDirectPrompt(question, spread, cards, '旧回复', '我已经核实过收入。', history),
      buildFollowUpWithExtrasPrompt(
        question,
        spread,
        cards,
        '旧回复',
        '请结合补牌。',
        cards,
        history,
      ),
    ]) {
      const messages = buildReadingMessages(prompt);
      expect(messages.map((message) => message.role)).toEqual(['system', 'user']);
      expect(messages[1].content).toContain(question);
      expect(messages[1].content).toContain('愚者（逆位）');
      expect(messages[1].content).not.toContain('## 措辞示范');
      expect(messages[0].content).toContain('已给过的背景直接使用');
      expect(messages[0].content).toContain('不逐牌反复说');
    }
    expect(buildReadingMessages('旧客户端或决策prompt')).toEqual([
      { role: 'user', content: '旧客户端或决策prompt' },
    ]);
  });

  it.each(['single', 'three-card', 'two-options', 'relationship', 'timeline', 'celtic-cross'])(
    '牌阵 %s 保留问题牌位并优先输出回应和行动',
    (id) => {
      const currentSpread = getSpreadById(id)!;
      const drawn = currentSpread.positions.map((position, index) => ({
        card: allCards[index],
        position,
        isReversed: index % 2 === 0,
      }));
      const prompt = buildInterpretationPrompt(
        '我已约好周五见面，怎么开口？',
        currentSpread,
        drawn,
      );
      expect(prompt).toContain('我已约好周五见面，怎么开口？');
      for (const card of drawn) {
        expect(prompt).toContain(card.position.nameCn);
        expect(prompt).toContain(card.position.description);
        expect(prompt).toContain(`${card.card.nameCn}（${card.isReversed ? '逆位' : '正位'}）`);
      }
      expect(prompt.indexOf('## 核心解读')).toBeLessThan(prompt.indexOf('## 可采取的行动'));
      expect(prompt.indexOf('## 可采取的行动')).toBeLessThan(prompt.indexOf('## 各牌说明'));
      expect(prompt).not.toContain('不回避难听的真相');
    },
  );

  it('三类追问均保留事实和牌，移除思考且不把模型猜测当事实', () => {
    const args = [
      '要主动联系吗',
      spread,
      cards,
      '<thinking>隐藏首轮思考</thinking>原先解读',
      '见面时怎么开口？',
    ] as const;
    for (const prompt of [
      buildFollowUpDecidePrompt(...args, history),
      buildFollowUpDirectPrompt(...args, history),
      buildFollowUpWithExtrasPrompt(...args, cards, history),
    ]) {
      expect(prompt).toContain('我们已约好周五见面');
      expect(prompt).toContain('讨论见面');
      expect(prompt).toContain('原先解读');
      expect(prompt).toContain('愚者（逆位）');
      expect(prompt).not.toContain('隐藏历史思考');
      expect(prompt).not.toContain('隐藏首轮思考');
      expect(prompt).toContain('用户明确纠正');
    }
  });

  it('区分本轮目标、明确感受与待核对解释，示范不作为用户事实', () => {
    const question = '我很平静，不想复合，只想在周五取回自己的东西。';
    const prompt = buildInterpretationPrompt(question, spread, cards);
    expect(prompt).toContain(`## 用户的问题\n${question}`);
    expect(prompt).toContain('明确不想要');
    expect(prompt).toContain('表达强度');
    expect(prompt).toContain('示范不是本轮事实');
    expect(prompt).toContain('不输出这些核对项');
  });

  it('三种追问入口保留无有效回答回合的补充并说明来源', () => {
    const input = ['如何准备见面', spread, cards, '建议见面', '我现在该怎么开口？'] as const;
    const failedHistory = [
      {
        question: '我明确不想复合，约见面只是取回物品。',
        interpretation: '',
        additionalCards: cards,
      },
    ];
    for (const prompt of [
      buildFollowUpDecidePrompt(...input, failedHistory),
      buildFollowUpDirectPrompt(...input, failedHistory),
      buildFollowUpWithExtrasPrompt(...input, cards, failedHistory),
    ]) {
      expect(prompt).toContain(failedHistory[0].question);
      expect(prompt).toContain('该轮没有有效完成的回答');
      expect(prompt).not.toContain('此前已完成的追问');
      expect(prompt).toContain('愚者（逆位）');
    }
  });

  it('每日入口共享事实边界，但不要求用户先提供问题或凑三段章节', () => {
    const prompt = buildDailyInterpretationPrompt(
      'The Fool',
      '愚者',
      true,
      ['审慎'],
      '留意下一步',
      '2026-09-15',
    );
    expect(prompt).toContain('2026-09-15');
    expect(prompt).toContain('愚者（The Fool）');
    expect(prompt).toContain('方位：逆位');
    expect(prompt).toContain('没有提供个人背景');
    expect(prompt).toContain('不补造经历');
    expect(prompt).not.toContain('给出 2–3 条');
    expect(prompt).not.toContain('## 核心解读');
  });

  it('首轮与补牌保留牌面说明，直接追问允许按需省略，行动不再强制', () => {
    const initial = buildInterpretationPrompt('今天只想说说感受，不需要建议。', spread, cards);
    const direct = buildFollowUpDirectPrompt(
      '问题',
      spread,
      cards,
      '旧回应',
      '我不是焦虑，只想核对时间。',
    );
    const extras = buildFollowUpWithExtrasPrompt(
      '问题',
      spread,
      cards,
      '旧回应',
      '请解读这次补牌',
      cards,
    );
    for (const prompt of [initial, direct, extras]) {
      expect(prompt).toContain('不需要行动时省略整个行动章节');
      expect(prompt).not.toContain('严格按下面三个');
    }
    expect(initial).toContain('覆盖本次全部已抽牌');
    expect(extras).toContain('解释本轮全部补牌');
    expect(direct).toContain('可以只输出核心解读');
    expect(direct).toContain('无需再次讨论牌面时省略');
  });
});
