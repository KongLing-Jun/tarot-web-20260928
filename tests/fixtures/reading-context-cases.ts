import { allCards } from '@/lib/tarot/cards';
import { getSpreadById } from '@/lib/tarot/spreads';
import type { DrawnCard } from '@/lib/tarot/types';
import type { InterpretationEmpathyCase } from './interpretation-empathy-cases';

/** 独立合成开发集；不含真实会话或封存留出题，不用于生产回答。 */
function fixedCards(spreadId: string, cardIds: string[]): DrawnCard[] {
  const spread = getSpreadById(spreadId)!;
  if (spread.positions.length !== cardIds.length) throw new Error('开发集牌位数量不一致');
  return spread.positions.map((position, index) => {
    const card = allCards.find((entry) => entry.id === cardIds[index]);
    if (!card) throw new Error('开发集卡牌不存在');
    return { card, position, isReversed: index === 1 };
  });
}

const preparationCards = fixedCards('three-card', ['pentacles-08', 'swords-02', 'major-14']);
const presentationCards = fixedCards('three-card', ['pentacles-03', 'wands-07', 'major-01']);
const choiceCards = fixedCards('two-options', [
  'major-11',
  'pentacles-12',
  'pentacles-04',
  'wands-11',
  'wands-03',
]);
const contextCards = fixedCards('single', ['major-09']);
const correctionCards = fixedCards('three-card', ['cups-06', 'swords-04', 'cups-02']);
const supportCards = fixedCards('single', ['major-08']);

const preparationQuestion =
  '我报名了社区读书会，下周要讲五分钟我喜欢的一本书。我已经读完，还没有讲稿，最想让没读过的人听懂一个观点。';
const presentationQuestion =
  '周五我要向同事演示一个自己完成的数据看板，有十分钟，今晚只有一小时准备。我担心讲得散，希望把它的用途讲清楚。';
const choiceQuestion =
  '周末有两个志愿活动可选，只能选一个。A 是在社区图书馆整理书目，任务独立、环境安静；B 是和四位陌生志愿者一起筹备市集，需要现场协调。两项都只占周六半天，路程和费用相同。';
const correctionQuestion =
  '我和大学室友近两个月只在群里联系。我想恢复一对一的交流，正在考虑邀请她周六喝茶。';
const correctionHistory = [
  {
    question: '我还没发邀请，之前只是提过以后可以聚聚。',
    interpretation: '可以先发一个具体时间的邀请，给她拒绝或改期的空间。',
    additionalCards: [],
  },
];
const supportQuestion =
  '今天评审会上，同事连续两次打断我，主持人也没有让我讲完。我很委屈，怕下次又这样。';

export const readingContextCases: InterpretationEmpathyCase[] = [
  {
    id: 'context-time-short',
    source: 'synthetic',
    mode: 'initial',
    spreadId: 'three-card',
    drawnCards: preparationCards,
    question: `${preparationQuestion}我只能在活动前拿出二十分钟，怎么准备？`,
    knownFacts: ['五分钟分享，目标是讲懂一个观点', '已读完书，尚无讲稿', '只有二十分钟准备'],
    goal: '在二十分钟内准备一次聚焦的分享',
    rejectedGoals: ['重新通读整本书', '制作复杂展示材料'],
    review: ['准备范围应符合二十分钟，不只复述时间限制', '不得虚构书名、具体观点或观众反应'],
  },
  {
    id: 'context-time-ample',
    source: 'synthetic',
    mode: 'initial',
    spreadId: 'three-card',
    drawnCards: preparationCards,
    question: `${preparationQuestion}我有三个晚上，每晚一小时，怎么准备？`,
    knownFacts: ['五分钟分享，目标是讲懂一个观点', '已读完书，尚无讲稿', '有三个晚上，每晚一小时'],
    goal: '利用分散的准备时间提高分享的清晰度',
    rejectedGoals: ['重新通读整本书', '制作复杂展示材料'],
    review: ['可利用跨晚的试讲或修订机会，不能仅替换时间数字', '不得虚构书名、具体观点或观众反应'],
  },
  {
    id: 'context-done-unprepared',
    source: 'synthetic',
    mode: 'initial',
    spreadId: 'three-card',
    drawnCards: presentationCards,
    question: `${presentationQuestion}我还没有列演示提纲，也没试讲过。现在优先做什么？`,
    knownFacts: ['看板由用户完成', '演示十分钟，准备只有一小时', '尚未列提纲或试讲'],
    goal: '明确演示准备的首要工作',
    rejectedGoals: ['继续开发看板功能'],
    review: [
      '应针对尚未形成讲述结构的阶段给出可执行内容',
      '不能假定看板已有某项功能或存在某项缺陷',
    ],
  },
  {
    id: 'context-done-prepared',
    source: 'synthetic',
    mode: 'initial',
    spreadId: 'three-card',
    drawnCards: presentationCards,
    question: `${presentationQuestion}我已经列好演示提纲并试讲了一遍，用了十五分钟。现在优先做什么？`,
    knownFacts: ['看板由用户完成', '演示十分钟，准备只有一小时', '已列提纲并试讲，试讲超时五分钟'],
    goal: '在已有提纲和试讲结果上解决演示超时',
    rejectedGoals: ['继续开发看板功能', '把重新列提纲或第一次试讲作为主要建议'],
    review: ['使用超时五分钟这一实际反馈改变准备重点', '不能仅把已完成的工作换词再布置一次'],
  },
  {
    id: 'context-goal-rest',
    source: 'synthetic',
    mode: 'initial',
    spreadId: 'two-options',
    drawnCards: choiceCards,
    question: `${choiceQuestion}我这周社交已经很多，周末想减少沟通消耗，同时做一点有意义的事。选哪个更合适？`,
    knownFacts: [
      'A 独立安静，B 需要与陌生人协调',
      '两项时间、路程和费用相同',
      '本周社交多，想减少沟通消耗',
    ],
    goal: '在参与志愿活动的同时减少沟通消耗',
    rejectedGoals: ['扩大社交圈'],
    review: [
      '取舍理由应由减少沟通消耗驱动，不得忽略既定任务差异',
      '不得编造身体疾病或志愿团队关系',
    ],
  },
  {
    id: 'context-goal-connect',
    source: 'synthetic',
    mode: 'initial',
    spreadId: 'two-options',
    drawnCards: choiceCards,
    question: `${choiceQuestion}我刚搬来，希望借这次活动认识附近的人，也愿意练习协调沟通。选哪个更合适？`,
    knownFacts: [
      'A 独立安静，B 需要与陌生人协调',
      '两项时间、路程和费用相同',
      '刚搬来，想认识附近的人并练习协调',
    ],
    goal: '增加与附近人互动和练习协调的机会',
    rejectedGoals: ['减少一切沟通'],
    review: [
      '相同牌面下理由应随社交目标改变，不能沿用休息目标的答案',
      '不能保证交到朋友或断言陌生人性格',
    ],
  },
  {
    id: 'context-background-missing',
    source: 'synthetic',
    mode: 'initial',
    spreadId: 'single',
    drawnCards: contextCards,
    question: '我该继续吗？',
    knownFacts: [],
    goal: '先明确继续什么以及用户关注的判断点',
    rejectedGoals: ['猜测是在问恋爱、工作或学习'],
    review: [
      '应提出一个能明确对象的关键问题，不铺开多个虚构情境',
      '不能给出具体继续或放弃的现实结论',
    ],
  },
  {
    id: 'context-background-provided',
    source: 'synthetic',
    mode: 'initial',
    spreadId: 'single',
    drawnCards: contextCards,
    question:
      '我参加了四次周末陶艺课，仍然喜欢做陶器，但每次往返要三小时，会挤掉我陪孩子的周日下午。老师允许转到家附近的同内容晚间班，费用不变，家人也愿意配合那个时间。我该继续原班还是转班？',
    knownFacts: [
      '已上四次，仍喜欢陶艺',
      '原班往返三小时，占用陪孩子的周日下午',
      '附近晚间班内容和费用相同，家人愿意配合',
    ],
    goal: '比较原班与转班，兼顾兴趣和家庭时间',
    rejectedGoals: ['把选择改为彻底放弃陶艺', '重复询问已经提供的课程内容和时间条件'],
    review: ['应使用通勤及家庭时间差异给出有依据的取舍', '不虚构家人不满、经济压力或孩子情绪'],
  },
  {
    id: 'context-correction-pending',
    source: 'synthetic',
    mode: 'direct',
    spreadId: 'three-card',
    drawnCards: correctionCards,
    question: correctionQuestion,
    previousInterpretation: '她已经答应了周六喝茶，你可以想想当天聊什么。',
    history: correctionHistory,
    followUpQuestion: '纠正一下：我昨天发了邀请，她还没回复，见面并未约成。今天应该再发消息吗？',
    knownFacts: ['昨天发出邀请', '对方尚未回复', '周六见面未约成', '旧模型说已答应是不实信息'],
    goal: '判断邀请未获回复时今天是否追加消息',
    rejectedGoals: ['安排已经确认的见面流程', '把未回复当作拒绝或不重视'],
    review: [
      '按最新纠正处理未确认状态，不能沿用旧模型或更早的未发邀请状态',
      '回答是否追加消息，同时保留未知原因',
    ],
  },
  {
    id: 'context-correction-confirmed',
    source: 'synthetic',
    mode: 'direct',
    spreadId: 'three-card',
    drawnCards: correctionCards,
    question: correctionQuestion,
    previousInterpretation: '她已经答应了周六喝茶，你可以想想当天聊什么。',
    history: correctionHistory,
    followUpQuestion:
      '更新一下：我昨天发了邀请，她今天明确答应周六下午两点在学校旁边的茶馆见面。今天还需要再发一条确认消息吗？',
    knownFacts: [
      '昨天发出邀请',
      '今天明确答应',
      '时间和地点已经约定',
      '更早历史中的未发邀请状态已经过时',
    ],
    goal: '判断时间地点已确认后是否还需重复确认',
    rejectedGoals: ['再次邀请或询问是否有空', '把已答应解读为恢复旧日亲密的承诺'],
    review: [
      '已确认应实质改变消息建议，不能沿用等待回复的答案',
      '事实依据应来自最新用户更新而非旧模型猜测',
    ],
  },
  {
    id: 'context-need-action',
    source: 'synthetic',
    mode: 'initial',
    spreadId: 'single',
    drawnCards: supportCards,
    question: `${supportQuestion}我想准备一句下次被打断时能当场说的话，帮我想一个自然的说法。`,
    knownFacts: ['评审中被同事连续打断两次', '主持人没有让用户讲完', '用户感到委屈并担心重演'],
    goal: '获得下次被打断时可直接使用的一句话',
    rejectedGoals: ['推断同事故意针对', '展开完整的职场斗争计划'],
    review: ['应给可当场说出的具体措辞并贴合发言被打断场景', '不能只说坚定边界或保持自信'],
  },
  {
    id: 'context-need-listening',
    source: 'synthetic',
    mode: 'initial',
    spreadId: 'single',
    drawnCards: supportCards,
    question: `${supportQuestion}我现在不想要建议或话术，只想有人听我说这件事。`,
    knownFacts: [
      '评审中被同事连续打断两次',
      '主持人没有让用户讲完',
      '用户感到委屈并担心重演',
      '明确不需要建议或话术',
    ],
    goal: '得到对具体经历的倾听和回应',
    rejectedGoals: ['安排沟通任务', '提供下次应对话术', '推断同事故意针对'],
    review: [
      '回应被打断且未能讲完的具体委屈，不能只给万能安慰',
      '不得因章节格式强塞行动建议或过度解释牌义',
    ],
  },
];

/** 同一 profile 内对照两题；另外用同一题的 P0/P2 匿名比较版本差异。 */
export const readingContextPairs: {
  id: string;
  caseIds: [string, string];
  expectation: string;
}[] = [
  {
    id: 'available-time',
    caseIds: ['context-time-short', 'context-time-ample'],
    expectation: '准备范围或迭代方式随可用时间变化，而不只是替换时长；两题仍围绕同一个分享目标。',
  },
  {
    id: 'completed-work',
    caseIds: ['context-done-unprepared', 'context-done-prepared'],
    expectation: '未准备时建立讲述重点，已试讲时使用超时反馈推进；不得重复布置已经完成的主要工作。',
  },
  {
    id: 'changed-goal',
    caseIds: ['context-goal-rest', 'context-goal-connect'],
    expectation: '相同选项与牌面下，建议和理由应受休息或社交目标影响，不能以牌面覆盖明确目标。',
  },
  {
    id: 'available-background',
    caseIds: ['context-background-missing', 'context-background-provided'],
    expectation: '缺对象时先问关键问题；已有充分条件时作有依据的取舍，不重复澄清或编造背景。',
  },
  {
    id: 'latest-correction',
    caseIds: ['context-correction-pending', 'context-correction-confirmed'],
    expectation:
      '依据最新用户信息区分未确认和已确认，建议有实质差异；不把旧模型或过时历史当成当前事实。',
  },
  {
    id: 'answer-need',
    caseIds: ['context-need-action', 'context-need-listening'],
    expectation: '要话术时提供场景适用的一句话；只倾诉时回应具体经历且不布置动作，两题均不读心。',
  },
];
