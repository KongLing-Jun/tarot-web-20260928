import { allCards } from './cards';
import type { DrawnCard, Suit } from './types';

/** Offline experiment only: original editorial notes based on this project's RWS card data.
 * Not a third-party book or a production-approved content pack. */
export const READING_KNOWLEDGE_VERSION = '2026-09-19-rws-draft-1';
export const READING_KNOWLEDGE_SOURCE = 'project:lib/tarot/cards.ts; original editorial synthesis';

const suitFocus: Record<Suit, string> = {
  wands: '意愿如何成为行动，推进力与消耗是否相称',
  cups: '情感回应、交流和关系边界，不等于已知对方心理',
  swords: '判断、表达与冲突如何影响当前问题，不把紧张等同失败',
  pentacles: '投入、资源、技能和持续性，不从牌直接推算财务结果',
};
const majorFocus = [
  '新开始的开放性与准备程度',
  '把已有手段组织成行动，不假设资源齐全',
  '保留观察与信息未明的空间，不认定有秘密',
  '滋养、创造与成长所需的条件',
  '秩序、边界与可持续结构',
  '已有规范、指导与个人判断之间的关系',
  '价值是否一致与选择是否出于自愿',
  '推进方向和协调控制',
  '克制与耐心如何承载力量',
  '独处思考与退缩隔离的区别',
  '变化和循环中的可控与不可控部分',
  '判断是否公平，责任是否清楚',
  '换视角与暂停，不直接等同被困',
  '结束旧形式与为转变腾出空间，不指实际死亡',
  '不同需求的协调与节奏',
  '牵制、欲望与自主性，不诊断成瘾或第三者',
  '原有结构受到冲击的主题，不预言灾难',
  '希望与恢复方向，不保证结果',
  '不明确的感受与信息，不认定欺骗',
  '清晰、活力与可见反馈，不保证成功',
  '回顾与回应改变的契机，不替用户裁定过去',
  '整合阶段成果与结束一个周期',
];

export function getReadingKnowledge(cardId: string, isReversed: boolean) {
  const card = allCards.find((item) => item.id === cardId);
  if (!card) throw new Error('未知牌面，无法装配知识参考');
  const focus =
    card.type === 'major'
      ? majorFocus[card.number]
      : `${suitFocus[card.suit!]}；结合${card.nameCn}的${(isReversed ? card.keywords.reversed : card.keywords.upright).join('、')}选择一个主主题`;
  return {
    cardId,
    orientation: isReversed ? ('reversed' as const) : ('upright' as const),
    focus,
    source: READING_KNOWLEDGE_SOURCE,
    version: READING_KNOWLEDGE_VERSION,
    reviewStatus: 'experimental' as const,
    expression: isReversed
      ? '从受阻、过度或内化中选择与本题和相邻牌位相符的解释，不把逆位机械等同坏结果，也不同时列出所有可能。'
      : '正位表示主题的直接表达，不等于事情有利；用牌位与本题约束判断它是支持还是阻力。',
    boundary:
      card.type === 'minor' && card.number > 10
        ? '宫廷牌先作为互动方式或角色解读；没有用户事实时不凭一张牌添加现实人物、性别或关系。'
        : '这是象征主题；不能据此补造经历、心理、资源或未来事件。',
  };
}

export function describeReadingKnowledge(cards: DrawnCard[]): string {
  return (
    `\n\n## 知识参考版本 ${READING_KNOWLEDGE_VERSION}（实验资料）\n` +
    cards
      .map((drawn) => {
        const entry = getReadingKnowledge(drawn.card.id, drawn.isReversed);
        return `${drawn.position.nameCn} · ${drawn.card.nameCn}：${entry.focus}。${entry.expression}${entry.boundary}`;
      })
      .join('\n') +
    '\n综合规则：牌位优先于普通排列；比较关键牌之间的支持与阻力，避免只串接同义词。相同花色是主题集中，不是现实概率；不同牌可以互补，也可以限制同一结论。'
  );
}
