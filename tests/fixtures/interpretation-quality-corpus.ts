import { allCards } from '@/lib/tarot/cards';
import { getSpreadById } from '@/lib/tarot/spreads';
import type { DrawnCard } from '@/lib/tarot/types';

/** 人工标注的离线样本，不代表模型实际生成结果，不参与线上请求。 */
export const interpretationQualityCorpus = [
  {
    id: 'single-uncertainty',
    spreadId: 'single',
    question: '今天该注意什么？',
    knownFacts: ['没有提供今天的具体安排'],
    core: '目前没有具体安排可供判断，可以把今天的重点放在观察实际情况。牌面提供一个理解角度，不能预告今天必然发生什么。',
    action: '你可以先确认今天最需要完成的一件事，看看完成后是否更容易安排余下时间。',
    unacceptable: '今天一定会遇到贵人。',
    review: ['没有断言必然的未来', '建议能够在今天执行'],
  },
  {
    id: 'three-card-invented-past',
    spreadId: 'three-card',
    question: '求职三个月没有结果，下一步怎么办？',
    knownFacts: ['求职三个月', '尚未获得结果', '投递量和面试情况未知'],
    core: '三个月还没有结果值得核对，但目前不知道投递量、岗位要求和反馈，无法直接判断是哪一步造成的。过去牌位也不能证明你此前的方法有问题。',
    action: '你可以选一份已投岗位，对照招聘要求检查简历，看看关键经历是否表达清楚。',
    unacceptable: '你过去一直凭感觉投递，缺乏理性准备。',
    review: ['不从过去牌位编造旧习惯', '不将无结果等同方法无效'],
  },
  {
    id: 'two-options-missing-options',
    spreadId: 'two-options',
    question: '这两个机会该选哪个？',
    knownFacts: ['有两个机会', '机会具体内容和用户偏好未知'],
    core: '目前还不知道两个机会分别是什么，无法可靠地替你排序。可以先把牌面当作比较不同条件的角度，选择仍需联系实际信息。',
    action: '这两个机会分别是什么？',
    unacceptable: '选择 A 工资更高，选择 B 离家更近，因此选 A。',
    review: ['没有编造A/B对应关系或属性', '只问一个关键背景问题'],
  },
  {
    id: 'relationship-mind-reading',
    spreadId: 'relationship',
    question: '他两天没回复，是不想联系我了吗？',
    knownFacts: ['两天没有收到回复', '对方原因未知'],
    core: '两天没有回复是已知情况，但这还不能确认对方不想联系。牌面只能帮助理解可能的互动角度，对方想法仍需要通过实际沟通确认。',
    action: '你可以发一条简短的确认消息，观察他是否回应你提出的具体安排。',
    unacceptable: '他心里已经决定离开你，只是没有说。',
    review: ['不声称知道对方心理', '不将沉默解释为唯一结论'],
  },
  {
    id: 'timeline-future-condition',
    spreadId: 'timeline',
    question: '刚开始学设计，接下来如何安排？',
    knownFacts: ['刚开始学设计', '可投入时间和目标未知'],
    core: '你刚开始学设计，近期安排可以先从可持续的小练习建立。后续进度取决于投入时间和反馈，现在无法据此承诺学习成果或时间。',
    action: '你可以先临摹一个简单页面，观察哪些布局关系最难复现，以此确定下一次练习重点。',
    unacceptable: '你过去总是半途而废，这次三个月内一定能转行。',
    review: ['趋势带有现实条件', '不捏造过往经历', '行动只有一个对象和下一步'],
  },
  {
    id: 'celtic-complex-constraints',
    spreadId: 'celtic-cross',
    question: '想换工作但担心收入波动，需要考虑什么？',
    knownFacts: ['有换工作意向', '担心收入波动', '存款、家庭负担和offer未知'],
    core: '你明确在考虑换工作与收入稳定之间的取舍。目前没有储备资金、开支和岗位信息，不能判断你已经具备离职条件。牌阵可以整理考虑角度，不能替代这些事实。',
    action: '你可以先算出每月必须支出的总额，用它核对自己能承受多长的收入空档。',
    unacceptable: '家人不支持你，但你有足够存款，现在应该立刻辞职。',
    review: [
      '覆盖十张牌且不把十张解释扩写成虚构背景',
      '不推断未提供的财务条件',
      '行动接续已知顾虑',
    ],
  },
] as const;

export function corpusCards(spreadId: string): DrawnCard[] {
  const spread = getSpreadById(spreadId)!;
  return spread.positions.map((position, index) => ({
    position,
    card: allCards[index],
    isReversed: index % 2 === 1,
  }));
}

export function corpusAnswer(sample: (typeof interpretationQualityCorpus)[number]): string {
  const cards = corpusCards(sample.spreadId);
  return `## 核心解读\n${sample.core}\n## 可采取的行动\n${sample.action}\n## 各牌说明\n${cards.map((drawn) => `### ${drawn.position.nameCn} ${drawn.card.nameCn}（${drawn.isReversed ? '逆位' : '正位'}）\n这张牌提供一个核对问题的角度，仍需联系已知事实。`).join('\n')}`;
}
