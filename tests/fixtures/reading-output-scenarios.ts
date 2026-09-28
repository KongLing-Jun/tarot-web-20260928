import { allCards } from '@/lib/tarot/cards';
import { getSpreadById } from '@/lib/tarot/spreads';
import type { DrawnCard, FollowUpHistoryEntry } from '@/lib/tarot/types';

/** 人工验收用固定输入，不用于生产抽牌或用户会话。 */
export interface ReadingOutputScenario {
  id: string;
  mode: 'initial' | 'direct' | 'extras';
  spreadId: string;
  question: string;
  drawnCards: DrawnCard[];
  previousInterpretation?: string;
  followUpQuestion?: string;
  history?: FollowUpHistoryEntry[];
  additionalCards?: DrawnCard[];
}

function fixedCards(spreadId: string, offset: number): DrawnCard[] {
  return getSpreadById(spreadId)!.positions.map((position, index) => ({
    card: allCards[offset + index],
    isReversed: index % 3 === 1,
    position,
  }));
}

const originals = [
  ['single', '我该继续这段关系吗？'],
  [
    'three-card',
    '我最近两周投了六份简历，收到一次面试邀请，还没有结果。接下来应该调整求职方向，还是继续投当前岗位？',
  ],
  [
    'two-options',
    '我有两个工作选择：A 是熟悉的运营岗位，通勤半小时，收入稳定；B 是转做产品助理，通勤一小时，起薪稍低。我希望学新东西，但目前只有三个月生活费。该如何选择？',
  ],
  [
    'relationship',
    '我们认识两个月，最近联系比之前少了。我主动发消息他通常会回复，但很少主动问我。我还想继续了解，又担心一直是我推动。该主动约见面吗？',
  ],
  [
    'timeline',
    '我准备在下个月启动一个周末摄影接单项目，已有设备，目前还没有付费客户，每周只能投入一天。接下来怎么推进比较合适？',
  ],
  [
    'celtic-cross',
    '我做运营三年了，最近想换工作学习产品，但还没有明确的目标岗位。现在的工作稳定，每周能拿出五小时准备，积蓄够六个月。我怎样判断转型是否适合，以及下一步先做什么？',
  ],
] as const;

export const readingOutputScenarios: ReadingOutputScenario[] = [
  ...[
    ['correct-fact', '你理解错了：我只是收到面试邀请，还没面试。我想知道今天能准备什么。'],
    ['correct-feeling', '我并不焦虑，也不难过。我很平静，只想判断是否要换一个求职方向。'],
    [
      'attempt-failed',
      '我已经按建议核对了岗位要求，也修改了简历，但新投的三份仍没有回复。接下来能尝试什么？',
    ],
    [
      'real-progress',
      '更新一下：我通过了面试，拿到了录用通知，要求明天答复。我还不知道试用期的考核要求。',
    ],
  ].map(([id, followUpQuestion]) => ({
    id,
    mode: 'direct' as const,
    spreadId: 'three-card',
    question: originals[1][1],
    drawnCards: fixedCards('three-card', 2),
    previousInterpretation:
      '你可能因面试结果焦虑。可以选一份已投岗位，对照招聘要求检查简历，观察能否找到需要补充的经历。',
    followUpQuestion,
  })),
  ...originals.map(([spreadId, question], index) => ({
    id: spreadId,
    mode: 'initial' as const,
    spreadId,
    question,
    drawnCards: fixedCards(spreadId, index * 2),
  })),
  {
    id: 'direct',
    mode: 'direct',
    spreadId: 'relationship',
    question: originals[3][1],
    drawnCards: fixedCards('relationship', 6),
    previousInterpretation:
      '可以通过一次轻松的邀约了解对方是否愿意继续互动，留意双方是否都在主动投入。',
    followUpQuestion: '那这次见面我该怎么开口？',
    history: [
      {
        question: '补充一下，我们其实已经分手一个月，不过已约好周五见面，我想确认能否平静相处。',
        interpretation: '既然已经分手，这次见面可以以确认彼此的相处边界为目的，不预设会复合。',
        additionalCards: [],
      },
    ],
  },
  {
    id: 'extras',
    mode: 'extras',
    spreadId: 'three-card',
    question: originals[1][1],
    drawnCards: fixedCards('three-card', 2),
    previousInterpretation:
      '可以复盘投递和面试的实际反馈，再决定是否调整方向，不需要从一次面试推断全部前景。',
    followUpQuestion: '这次面试我怎样准备会更有针对性？',
    history: [
      {
        question: '已经收到第二轮面试，时间是周五，岗位是电商运营，面试官让我准备以前做过的项目。',
        interpretation: '可以选择自己参与最深的项目，说明目标、行动和实际结果。',
        additionalCards: [],
      },
    ],
    additionalCards: fixedCards('three-card', 14)
      .slice(0, 2)
      .map((drawn, index) => ({
        ...drawn,
        position: {
          id: `evaluation-extra-${index}`,
          name: `Extra ${index + 1}`,
          nameCn: `补充指引 ${index + 1}`,
          description: '回应本次追问的补充视角',
        },
      })),
  },
];
