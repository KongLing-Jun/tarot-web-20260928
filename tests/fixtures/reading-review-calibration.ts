import { readingP1DevelopmentCases, type ReadingP1Case } from './reading-p1-cases';

type CalibrationScenario = Pick<
  ReadingP1Case,
  | 'category'
  | 'mode'
  | 'question'
  | 'spreadId'
  | 'drawnCards'
  | 'knownFacts'
  | 'goal'
  | 'rejectedGoals'
  | 'review'
>;

export interface ReadingReviewCalibrationCase {
  id: string;
  scenario: CalibrationScenario;
  goodAnswer: string;
  badAnswer: string;
  /** 人工校准标签，仅供调用后的本地核对，不能放入裁判输入。 */
  expectedFailure: {
    dimension: 'directAnswer' | 'consistency' | 'efficiency' | 'faithfulness';
    quote: string;
    reason: string;
  };
}

function scenario(id: string): CalibrationScenario {
  const source = readingP1DevelopmentCases.find((item) => item.id === `p1-development-${id}`);
  if (!source) throw new Error(`Unknown development calibration scenario: ${id}`);
  const {
    category,
    mode,
    question,
    spreadId,
    drawnCards,
    knownFacts,
    goal,
    rejectedGoals,
    review,
  } = source;
  return {
    category,
    mode,
    question,
    spreadId,
    drawnCards,
    knownFacts,
    goal,
    rejectedGoals,
    review,
  };
}

/** 手工合成的裁判校准对照，不是真实模型输出，也不计入解读候选胜率。 */
export const readingReviewCalibrationCases: ReadingReviewCalibrationCase[] = [
  {
    id: 'invented-signing-date',
    scenario: scenario('judgment-contract-open'),
    goodAnswer:
      '按这组牌看，本月签约偏乐观。未来位太阳正位的明朗、达成主题是主要支持；现在位宝剑2逆位的信息不足主题则限制了对进度的判断。你已确认需求和预算，但审批尚未结束，所以这份乐观是牌面倾向，不能换算成具体签约日。',
    badAnswer:
      '本月能签，而且会在本月最后一个周五完成签署。未来位太阳正位说明结果明朗，现在宝剑2逆位说明审批已到最后一轮，星币8正位也证明条款审核没有问题。你只需等待对方通知。',
    expectedFailure: {
      dimension: 'faithfulness',
      quote: '会在本月最后一个周五完成签署',
      reason: '新增具体签约时间；用户没有提供审批轮次或条款审核结论，牌面也不能确立这些现实事实。',
    },
  },
  {
    id: 'invented-history-and-motive',
    scenario: scenario('trend-studio-growth'),
    goodAnswer:
      '接下来一个月更像积累期。近期趋势位权杖8逆位的减速，与当下星币2正位的调配主题相连，更支持维持和调整，而非迅速扩张。现实中“老客回购、新客增长慢”也与这个方向相符；过去位圣杯5逆位可以提供接受现状、继续前行的观察角度，但不能据此认定你经历过什么。',
    badAnswer:
      '接下来一个月更像积累期。权杖8逆位代表增长减速，星币2正位代表经营调配。圣杯5逆位还说明你开业时受过顾客差评，曾因此失去信心；现在新客迟迟不来，是因为他们觉得你的作品缺少特色。这个心理障碍解决后，增长就会恢复。',
    expectedFailure: {
      dimension: 'faithfulness',
      quote: '你开业时受过顾客差评，曾因此失去信心',
      reason: '把过去牌位写成未提供的差评经历和情绪，又补写新客户的评价与动机。',
    },
  },
  {
    id: 'choice-goal-and-budget',
    scenario: scenario('choice-training-buffer'),
    goodAnswer:
      '按你重视转型的目标，我更倾向B。税后5000减固定支出4000，每月还余1000，现有数字没有固定支出缺口；这不等于已覆盖所有未列出的支出。B的发展位权杖侍从正位呼应学习新方向，结果位愚者逆位提示进入前看清岗位实际能学到什么。A的星币骑士与星币9更偏稳定积累，但稳定不是你这次最优先的目标。',
    badAnswer:
      '应该选A。星币骑士到星币9比B的愚者逆位稳妥，稳定永远比转型更重要。B每月税后5000、固定支出4000，每月缺口1000，即使有半年积蓄也会很快花完，因此目前没有选择B的经济条件。',
    expectedFailure: {
      dimension: 'consistency',
      quote: '每月缺口1000',
      reason:
        '把正结余算成缺口，并用“稳定永远更重要”覆盖用户明确的转型目标；不是单纯因选择A而判错。',
    },
  },
  {
    id: 'repetition-without-answer',
    scenario: scenario('other-initiative-low'),
    goodAnswer:
      '按这组牌，继续了解的兴趣偏正面，但主动推进的力度偏弱。现状位圣杯2正位支持连接，走向节制正位偏慢慢调和；宝剑国王逆位与权杖5的张力，使这个倾向还不足以读成明确承诺。你说他认真回复、赴约却未主动邀约，正好需要把“愿意接触”和“主动推进”分开看，这仍不能确认他的真实内心。',
    badAnswer:
      '感情需要双方共同努力，也需要给彼此时间。圣杯2告诉我们关系需要连接，节制告诉我们关系需要平衡。因此要在连接中找到平衡，也要在平衡中保持连接。不要急着问他有没有兴趣，最重要的是照顾好自己，顺其自然，让时间给出答案。',
    expectedFailure: {
      dimension: 'directAnswer',
      quote: '不要急着问他有没有兴趣',
      reason: '用共同努力、平衡与等待替代用户问的发展兴趣；重复通用原则而没有给出该牌组的倾向。',
    },
  },
  {
    id: 'listening-without-tasks',
    scenario: scenario('listening-effort-unseen'),
    goodAnswer:
      '连着三次没入选，今天失落很自然。你已经知道还能继续投，这会儿并不缺一份投稿计划，只是希望失落能被听见。权杖9逆位的松劲与疲惫，可以作为此刻的一个隐喻：不用立刻把自己重新鼓起来，也不用证明下一次一定更好。',
    badAnswer:
      '连着三次没入选确实令人失落，但你不能停在这里。权杖9逆位说明要重新振作：今晚列出十个投稿平台，明天联系三位编辑，再把作品重写一遍。完成这些任务就会恢复信心，下次一定能入选。',
    expectedFailure: {
      dimension: 'faithfulness',
      quote: '今晚列出十个投稿平台，明天联系三位编辑，再把作品重写一遍',
      reason: '违背用户明确“不要教投稿、只想说说”的意愿，另有未经支持的入选保证。',
    },
  },
  {
    id: 'bounded-tendency-is-an-answer',
    scenario: scenario('judgment-contract-blocked'),
    goodAnswer:
      '按这组牌，我不看好本月顺利签下，更偏向暂时难以落定。现在位圣杯4正位的停顿，与未来位星币4逆位的松动主题连在一起，对按期稳定落定的支持较弱。需求和预算已确认是现实进展；这组牌的保留倾向不等于审批已经被拒，也不能确定会拖到哪一天。',
    badAnswer:
      '塔罗不能证明本月能签，也不能证明本月不能签，所以无法回答你的问题。圣杯4和星币4逆位都可能有很多含义，任何走向都有可能。是否能签只能等审批结束，请以现实为准。',
    expectedFailure: {
      dimension: 'directAnswer',
      quote: '所以无法回答你的问题',
      reason:
        '用户问的是牌面倾向而非结果保证；好答案明确给出有边界的负面倾向，不应因保留现实不确定性扣掉答题分。',
    },
  },
];
