import { readingOutputScenarios, type ReadingOutputScenario } from './reading-output-scenarios';

/** 合成评估输入，不是用户聊天记录或实际模型输出；不得计入真实样本数量。 */
export interface InterpretationEmpathyCase extends Omit<ReadingOutputScenario, 'mode'> {
  source: 'synthetic';
  mode: ReadingOutputScenario['mode'] | 'daily';
  knownFacts: string[];
  goal: string;
  rejectedGoals: string[];
  review: string[];
  date?: string;
}

const initialReviews: Record<string, string[]> = {
  single: ['背景不足时不编造冲突或用户情绪', '围绕是否继续关系提出有区分力的判断条件'],
  'three-card': [
    '保留两周、六份申请、一次邀请且未面试的事实',
    '不把没有结果推断为能力差或方法无效',
  ],
  'two-options': [
    '准确保留 A/B 的岗位、通勤、收入差别',
    '结合三个月生活费比较学习机会与成本，不替用户决定',
  ],
  relationship: ['区分他回复但较少主动与他不在意的推断', '承接想继续了解又不想单方面推动的取舍'],
  timeline: ['承接每周一天、已有设备和无付费客户的限制', '只推进一个可验证的当前障碍，不保证收入'],
  'celtic-cross': [
    '承接稳定工作、每周五小时和六个月积蓄',
    '十张牌不扩写成未提供的家庭阻力或潜意识事实',
  ],
};

const job = readingOutputScenarios.find((scenario) => scenario.id === 'three-card')!;
const relationship = readingOutputScenarios.find((scenario) => scenario.id === 'relationship')!;
const asCase = (scenario: ReadingOutputScenario): InterpretationEmpathyCase => ({
  ...scenario,
  source: 'synthetic',
  knownFacts: [
    scenario.question,
    ...(scenario.followUpQuestion ? [scenario.followUpQuestion] : []),
  ],
  goal: scenario.followUpQuestion ?? scenario.question,
  rejectedGoals: [],
  review: initialReviews[scenario.id] ?? [
    '优先回应本轮明确补充',
    '旧模型解释不能覆盖用户事实和纠正',
  ],
});

export const interpretationEmpathyCases: InterpretationEmpathyCase[] = [
  ...readingOutputScenarios.map(asCase),
  ...[
    {
      id: 'context-vague',
      question: '想看最近这件事的走向。',
      facts: [],
      goal: '明确关键问题后再做针对性解读',
      review: [
        '简短回应后尽早问一个关键问题',
        '不先列工作感情财务等多种可能',
        '不逐牌重复免责声明',
      ],
    },
    {
      id: 'context-specific',
      question:
        '我已经接到电商运营二面邀请，周五面试，还没进行。面试官让我讲一个以前做过的项目，我只有周四晚上两小时准备。怎样准备最有效？',
      facts: ['已接到二面邀请，面试尚未发生', '要求讲以前做过的项目', '周四晚上只有两小时准备'],
      goal: '聚焦有限时间内的面试准备',
      review: [
        '直接建议如何利用两小时准备项目',
        '不能再问是工作还是感情',
        '不假定已面试或过去准备不足',
        '与context-vague同牌而回应实质不同',
      ],
    },
  ].map((item) => ({
    ...asCase(job),
    id: item.id,
    question: item.question,
    knownFacts: item.facts,
    goal: item.goal,
    review: item.review,
  })),
  ...[
    {
      id: 'goal-reconcile',
      question: '我们已分手一个月，约好周五见面。我希望看看有没有复合的可能，怎样谈比较好？',
      goal: '了解是否存在双方愿意复合的基础',
      rejected: [],
    },
    {
      id: 'goal-not-reconcile',
      question:
        '我们已分手一个月，约好周五见面。我不想复合，只想把留在他那里的物品拿回来，怎样谈比较好？',
      goal: '取回物品并结束此事',
      rejected: ['复合', '重新建立感情'],
    },
  ].map((item) => ({
    ...asCase(relationship),
    id: item.id,
    mode: 'direct' as const,
    previousInterpretation: '你可以考虑约一次见面，了解双方是否还愿意继续这段关系。',
    followUpQuestion: item.question,
    knownFacts: [item.question],
    goal: item.goal,
    rejectedGoals: item.rejected,
    review: ['同牌面下随明确目标改变回应', '不将拒绝复合解释为口是心非或隐藏需求'],
  })),
  {
    ...asCase(job),
    id: 'failed-turn-facts',
    mode: 'direct',
    previousInterpretation: '你可以先核对岗位要求与简历，再考虑是否调整投递方向。',
    history: [
      {
        question: '补充一下：我已经修改过简历了，而且只有周末能准备，工作日要照顾家人。',
        interpretation: '',
        additionalCards: [],
      },
    ],
    followUpQuestion: '根据刚才补充的情况，这周我先做什么？',
    knownFacts: [
      '简历已经修改',
      '只有周末能准备',
      '工作日照顾家人',
      '前次回答失败，但用户补充已提交',
    ],
    goal: '在已有尝试和时间限制内找到下一步',
    rejectedGoals: ['再次把修改简历作为尚未做过的第一步'],
    review: ['承接空回答回合中的用户输入', '不编造已面试或新的家庭冲突', '不安排工作日准备'],
  },
  {
    ...asCase(job),
    id: 'listen-only',
    question:
      '投了三个月简历都没结果，我开始怀疑是不是自己太差了。今天不想听任务清单，只想把这个感受说出来。',
    knownFacts: ['投递三个月无结果', '开始自我怀疑', '当前不想要任务清单'],
    goal: '表达困扰并获得与经历相符的回应',
    rejectedGoals: ['强制执行建议或任务清单'],
    review: [
      '联系三个月投入后无结果的具体经历',
      '不认定用户能力差或保证未来成功',
      '不强迫继续行动',
    ],
  },
  {
    ...asCase(readingOutputScenarios.find((scenario) => scenario.id === 'single')!),
    id: 'daily-no-context',
    mode: 'daily',
    question: '',
    date: '2026-09-15',
    knownFacts: ['只有日期和实际当日牌，无个人背景'],
    goal: '提供简短且有牌面依据的观察角度',
    rejectedGoals: [],
    review: ['不虚构当日事件、情绪、人际关系或必然预测', '不强凑多条建议', '正逆位与固定牌面一致'],
  },
];
