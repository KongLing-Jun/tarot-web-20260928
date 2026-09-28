/** Shared guidance for manual selection, automatic selection and reading context. */
export interface SpreadGuidance {
  summary: string;
  suitableFor: string;
  requiredContext: string;
  exampleQuestion: string;
  boundary: string;
}

export const spreadGuidance: Record<string, SpreadGuidance> = {
  single: {
    summary: '聚焦一个问题，获得当下的观察角度',
    suitableFor: '每日自省、眼前的一件小事，或背景较少时先聚焦一个问题。',
    requiredContext: '你关心的具体问题；若有目标或限制，也请说明。',
    exampleQuestion: '明天要做汇报，我最值得留意什么？',
    boundary: '只提供一个观察角度，不能据此判断完整因果或确认外部结果。',
  },
  'three-card': {
    summary: '串联已知经过、当下与后续趋势',
    suitableFor: '已有一件具体事情，想从过去、现在与后续趋势梳理发展脉络。',
    requiredContext: '已经发生了什么、当前进展，以及你想了解的后续方向。',
    exampleQuestion: '上周提交了方案，对方今天要求调整预算，接下来应留意什么？',
    boundary: '过去牌位不补写未提供的经历；未来牌位表达趋势，不承诺结果或日期。',
  },
  'two-options': {
    summary: '围绕你的目标，比较两个明确选项',
    suitableFor: '已有明确的 A、B 两个选项，想比较各自的过程、代价与可能走向。',
    requiredContext: 'A 和 B 分别是什么、最看重的目标，以及已知收益、成本和限制。',
    exampleQuestion: '留在原岗位或接受转岗机会？我想积累产品经验，也需要维持现有收入。',
    boundary: '不能替你编造选项、收入或条件；牌面不能替代真实收支与现实限制。',
  },
  relationship: {
    summary: '结合真实互动，梳理两人的关系',
    suitableFor: '有具体的两人互动，想梳理自己的感受、互动模式、分歧与沟通方向。',
    requiredContext: '双方是什么关系、最近具体说了或做了什么，以及你想解决的关系问题。',
    exampleQuestion: '朋友两次取消见面后主动提出改约，我怎样沟通才能说清自己的在意？',
    boundary: '“对方的感受”只是象征观察角度，不能据牌面确认对方心理、动机或隐情。',
  },
  timeline: {
    summary: '沿事件经过，复盘影响与行动方向',
    suitableFor: '已提供事件经过，想复盘起因、过去影响、当前卡点与下一步行动。',
    requiredContext: '关键事件的先后顺序、已经尝试的行动、当前反馈和想改变的局面。',
    exampleQuestion: '项目经历需求调整、延期和重新分工，哪些已知因素值得复盘，下一步先处理什么？',
    boundary: '“根源”须与已知经过核对，不能把牌意当成真实原因，也不能推算精确时间。',
  },
  'celtic-cross': {
    summary: '在充分背景下，梳理多方面的牵连',
    suitableFor: '问题涉及多个相互影响的方面，且已有充分背景，需要综合梳理目标、阻碍与资源。',
    requiredContext: '问题背景、当前处境、明确目标、现实约束，以及已知的外部影响。',
    exampleQuestion: '我计划转行，已了解学习安排、家庭支出和岗位要求，怎样统筹这些因素？',
    boundary: '十张牌不代表更准确；潜意识、外部影响和结果牌位均不能替代未提供的事实。',
  },
};

export function getSpreadGuidance(spreadId: string): SpreadGuidance | undefined {
  return Object.hasOwn(spreadGuidance, spreadId) ? spreadGuidance[spreadId] : undefined;
}

// Keep these reading perspectives separate from the legacy spread data used by P0.
const positionGuidance: Record<string, string> = {
  'single-1': '以这张牌的象征主题，聚焦当前问题的一个观察角度。',
  'three-1': '用牌面主题回看你已说明的经历，不补写未知的过去。',
  'three-2': '把牌面主题与已知现状对照，梳理本题的重点。',
  'three-3': '观察牌面支持或限制的后续趋势，不保证现实结果或日期。',
  'two-options-1': '围绕已说明的目标与限制，观察这次抉择的核心取舍。',
  'two-options-2': '从象征主题比较选择 A 的过程，现实成本以你提供的信息为准。',
  'two-options-3': '观察选择 A 的象征走向，不能据此确定实际收益或结果。',
  'two-options-4': '从象征主题比较选择 B 的过程，现实成本以你提供的信息为准。',
  'two-options-5': '观察选择 B 的象征走向，不能据此确定实际收益或结果。',
  'relationship-1': '用牌面主题回看你已表达的感受，不替你定义隐藏情绪。',
  'relationship-2': '从这一位置观察关系中的象征主题，不能确认对方真实心理或动机。',
  'relationship-3': '把牌面主题与已说明的互动对照，梳理关系中的连接。',
  'relationship-4': '观察哪些象征主题值得用于核对双方的实际分歧。',
  'relationship-5': '综合关系牌面观察发展倾向，不代替双方的真实选择与回应。',
  'timeline-1': '用牌面主题提出复盘角度，起因仍须由已知经过支持。',
  'timeline-2': '对照已经提供的经历，观察哪些影响值得回看。',
  'timeline-3': '联系当前已知进展，提炼此刻值得关注的主题。',
  'timeline-4': '观察近期的象征倾向，不据此推算事件发生的精确时间。',
  'timeline-5': '结合牌面主题与现实限制，形成可选择的行动方向。',
  'celtic-1': '把牌面主题与已知处境对照，聚焦当前的问题。',
  'celtic-2': '观察与现状牌相互制约的主题，不把它直接认定为现实障碍。',
  'celtic-3': '回看你已提供的过去经历；没有经历资料时，只说明观察角度。',
  'celtic-4': '观察近期可能的象征走向，不保证会发生某件事情。',
  'celtic-5': '围绕你已说明的目标，观察牌面主题支持的方向。',
  'celtic-6': '提供自我反思的角度，不据此认定未表达的潜意识或心理原因。',
  'celtic-7': '结合本题目标与现实约束，提出可考虑的做法。',
  'celtic-8': '对照已知环境与他人行为，不补写未知的外部事件或动机。',
  'celtic-9': '回看你已表达的期待和顾虑，不假定你内心必然如何。',
  'celtic-10': '综合其他牌位形成象征上的整体倾向，不承诺最终结果。',
};

export function getSpreadPositionGuidance(positionId: string): string | undefined {
  return Object.hasOwn(positionGuidance, positionId) ? positionGuidance[positionId] : undefined;
}
