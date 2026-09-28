export type ReadingActionDimension = 'goalAlignment' | 'executability' | 'groundedConditions';

export interface ReadingActionScores {
  goalAlignment: number;
  executability: number | null;
  groundedConditions: number;
}

export interface ReadingActionCalibrationCase {
  id: string;
  scenario: {
    question: string;
    knownFacts: string[];
    goal: string;
    review: string[];
    cards: [];
  };
  goodAnswer: string;
  badAnswer: string;
  expectedFailure: { dimension: ReadingActionDimension; quote: string; reason: string };
  expectedScores: { good: ReadingActionScores; bad: ReadingActionScores };
  actionNeed: 'required' | 'not-required';
}

// Synthetic calibration material only. These expectations are not sent to the reviewer.
export const readingActionCalibrationCases: ReadingActionCalibrationCase[] = [
  {
    id: 'action-goal-rejected-publication',
    scenario: {
      question: '我只想把海报初稿整理好给同事看，明确不想公开发布。现在先做什么？',
      knownFacts: [
        '用户已有一张海报初稿。',
        '用户可以编辑初稿并发送给同事，也有可发布图片的社交账号。',
        '本轮只做内部看稿，不公开发布。',
      ],
      goal: '准备可供同事查看的内部海报初稿。',
      review: ['依据用户明确的交付对象和使用范围评估建议。'],
      cards: [],
    },
    goodAnswer: '先把初稿导出成一张图片，发给同事，并只问一句：“你第一眼看到的活动名称是什么？”',
    badAnswer: '先把初稿导出成一张图片，发布到公开社交账号，并在文末邀请陌生人转发。',
    expectedFailure: {
      dimension: 'goalAlignment',
      quote: '发布到公开社交账号',
      reason: '用户明确只做内部看稿并拒绝公开发布，建议改成了公开推广。',
    },
    expectedScores: {
      good: { goalAlignment: 2, executability: 2, groundedConditions: 2 },
      bad: { goalAlignment: 0, executability: 2, groundedConditions: 2 },
    },
    actionNeed: 'required',
  },
  {
    id: 'action-goal-latest-correction',
    scenario: {
      question:
        '刚才我说要删重复照片，现在改主意了：一张都保留，只想按活动分文件夹。第一步怎么做？',
      knownFacts: [
        '用户能在设备中创建文件夹、移动和删除照片。',
        '用户最新决定保留全部照片。',
        '当前目标是按活动整理照片。',
      ],
      goal: '在不删除照片的前提下开始按活动分类。',
      review: ['以最新明确表达的目标为准。'],
      cards: [],
    },
    goodAnswer:
      '先建一个以某次活动命名的文件夹，把确认属于那次活动的照片移进去；暂时不确定的先留在原处。',
    badAnswer: '先按拍摄时间排列照片，把同一分钟内构图相似的照片只留一张，其余删除。',
    expectedFailure: {
      dimension: 'goalAlignment',
      quote: '其余删除',
      reason: '建议执行的是用户已经撤回的删除目标，违反最新的一张都保留。',
    },
    expectedScores: {
      good: { goalAlignment: 2, executability: 2, groundedConditions: 2 },
      bad: { goalAlignment: 0, executability: 2, groundedConditions: 2 },
    },
    actionNeed: 'required',
  },
  {
    id: 'action-goal-listening-only',
    scenario: {
      question: '今天演讲卡壳，我有点难受。先别帮我制定练习计划，我只是想把这件事说出来。',
      knownFacts: ['用户今天演讲时卡壳。', '用户感到难受。', '用户目前只想倾诉，不要练习计划。'],
      goal: '回应用户已经表达的感受，为继续倾诉留出空间。',
      review: ['根据本轮明确需要判断是否适合提供行动建议。'],
      cards: [],
    },
    goodAnswer: '演讲卡壳让你难受，这件事可以先说出来。你想继续讲，我就在这里听。',
    badAnswer: '现在就制定练习计划：每天对着镜子讲三遍，再把每次卡壳的位置记录下来。',
    expectedFailure: {
      dimension: 'goalAlignment',
      quote: '现在就制定练习计划',
      reason: '用户明确拒绝本轮制定计划，回答却强行转入训练安排。',
    },
    expectedScores: {
      good: { goalAlignment: 2, executability: null, groundedConditions: 2 },
      bad: { goalAlignment: 0, executability: null, groundedConditions: 2 },
    },
    actionNeed: 'not-required',
  },
  {
    id: 'action-goal-preserve-voice',
    scenario: {
      question: '这封感谢信我只想检查错别字，保留自己的语气，不想重写。应该怎么检查？',
      knownFacts: [
        '用户已写完一封感谢信，可以编辑全文。',
        '用户只要求检查错别字。',
        '用户要保留自己的语气和原有内容。',
      ],
      goal: '在不重写内容和语气的前提下查找错别字。',
      review: ['考虑用户允许修改的范围。'],
      cards: [],
    },
    goodAnswer: '从最后一段往前逐句读，只标记疑似错别字，再逐个核对；不改句式和内容。',
    badAnswer: '逐句把口语改成正式书面语，再删去你写的个人感受，把全文压成三句标准致谢。',
    expectedFailure: {
      dimension: 'goalAlignment',
      quote: '把口语改成正式书面语',
      reason: '用户只要求查错字并保留语气，建议却重写语气和内容。',
    },
    expectedScores: {
      good: { goalAlignment: 2, executability: 2, groundedConditions: 2 },
      bad: { goalAlignment: 0, executability: 2, groundedConditions: 2 },
    },
    actionNeed: 'required',
  },
  {
    id: 'action-execution-empty-advice',
    scenario: {
      question: '我已经写好一封活动邀请，想让收件人知道需要回复什么。现在该改哪里？',
      knownFacts: ['邀请草稿已经写好。', '用户希望收件人回复是否参加。', '用户可以修改邀请文字。'],
      goal: '让邀请清楚表达希望收件人回复的内容。',
      review: ['检查用户是否能据建议明确开始修改。'],
      cards: [],
    },
    goodAnswer:
      '在邀请结尾加一句：“请回复是否参加这次活动。”先把这句话放进去，再检查前文是否有重复的回复要求。',
    badAnswer: '为了让收件人知道需要回复什么，你要提升表达能力，把邀请写得更清晰、更有重点。',
    expectedFailure: {
      dimension: 'executability',
      quote: '提升表达能力',
      reason: '回答沿用正确目标，却没有指出可执行的修改位置、动作或内容。',
    },
    expectedScores: {
      good: { goalAlignment: 2, executability: 2, groundedConditions: 2 },
      bad: { goalAlignment: 2, executability: 0, groundedConditions: 2 },
    },
    actionNeed: 'required',
  },
  {
    id: 'action-execution-known-device',
    scenario: {
      question: '今晚只能用手机，也借不到电脑。我想把文档里三处错字改好，怎么做？',
      knownFacts: [
        '用户今晚只有手机，无法借用电脑。',
        '文档已能用手机上的编辑器打开并保存。',
        '需要修正的三处错字位置已经确定。',
      ],
      goal: '利用今晚可用的设备完成三处错字修正。',
      review: ['结合明确可用的设备与编辑能力判断操作能否完成。'],
      cards: [],
    },
    goodAnswer: '用手机编辑器打开文档，逐一定位三处错字并替换；保存后重新打开，核对三处都已改好。',
    badAnswer:
      '虽然你今晚只有手机且借不到电脑，还是请在电脑上打开桌面编辑器，逐一改好三处错字后保存。',
    expectedFailure: {
      dimension: 'executability',
      quote: '在电脑上打开桌面编辑器',
      reason:
        '建议明确承认设备约束，却要求使用当晚不可获得的设备，操作无法执行；它没有声称用户已有电脑。',
    },
    expectedScores: {
      good: { goalAlignment: 2, executability: 2, groundedConditions: 2 },
      bad: { goalAlignment: 2, executability: 0, groundedConditions: 2 },
    },
    actionNeed: 'required',
  },
  {
    id: 'action-execution-outside-control',
    scenario: {
      question: '我希望同事同意和我换班。我能发消息问他，但不能替他决定。下一步怎么做？',
      knownFacts: [
        '用户可以给同事发消息。',
        '同事尚未表达是否愿意换班。',
        '换班需要同事自愿同意，用户不能代替他决定。',
      ],
      goal: '争取同事同意换班，并获得明确答复。',
      review: ['区分用户能采取的行动与由他人决定的结果。'],
      cards: [],
    },
    goodAnswer:
      '发消息问：“你愿意和我换这次班吗？不方便也可以直接说。”收到答复后再决定是否继续协调。',
    badAnswer: '下一步就是让同事必须答应换班，把他的答复直接变成“同意”。',
    expectedFailure: {
      dimension: 'executability',
      quote: '把他的答复直接变成“同意”',
      reason: '回答把不受用户控制的他人决定当作用户可以直接执行的动作；没有声称同事已经同意。',
    },
    expectedScores: {
      good: { goalAlignment: 2, executability: 2, groundedConditions: 2 },
      bad: { goalAlignment: 2, executability: 0, groundedConditions: 2 },
    },
    actionNeed: 'required',
  },
  {
    id: 'action-execution-feedback-method',
    scenario: {
      question:
        '我有两个说明书标题，两位没看过正文的同事愿意试读。我想知道哪个更容易看懂，具体该怎么收集反馈和判断？',
      knownFacts: [
        '用户有两个候选标题。',
        '两位未读正文的同事愿意分别试读标题。',
        '正文用途是指导新人提交报销申请。',
      ],
      goal: '通过可观察的反馈比较两个标题是否让人理解说明书用途。',
      review: ['检查是否提供了与理解程度有关的反馈获取和判断方法。'],
      cards: [],
    },
    goodAnswer:
      '先让两位同事各看一个标题，问同一句：“你觉得这份说明书教你做什么？”记下原话，再对照是否提到提交报销申请；如果两边都能说清用途，就先不宣称某个更好。',
    badAnswer: '让两位同事各看一个标题，收集反馈，然后综合判断哪个更容易看懂。',
    expectedFailure: {
      dimension: 'executability',
      quote: '收集反馈，然后综合判断',
      reason: '已有试读动作，但没有回答用户专门询问的如何提问、记录和判断，关键执行环节仍不明确。',
    },
    expectedScores: {
      good: { goalAlignment: 2, executability: 2, groundedConditions: 2 },
      bad: { goalAlignment: 2, executability: 1, groundedConditions: 2 },
    },
    actionNeed: 'required',
  },
  {
    id: 'action-grounding-event-stage',
    scenario: {
      question: '场地申请已经提交，但还没收到审批结果。我想确认什么时候能布置，怎么问负责人？',
      knownFacts: [
        '场地申请已提交。',
        '用户尚未收到审批结果。',
        '用户可以联系负责人询问状态和可布置时间。',
      ],
      goal: '向负责人确认场地申请状态及允许开始布置的时间。',
      review: ['区分已知申请进度与仍需向负责人确认的信息。'],
      cards: [],
    },
    goodAnswer:
      '给负责人发一句：“想确认场地申请现在到哪一步了；如果获批，最早什么时候可以开始布置？”',
    badAnswer:
      '你的场地申请已经通过审批。\n给负责人发一句：“请确认获批场地最早什么时候可以开始布置？”',
    expectedFailure: {
      dimension: 'groundedConditions',
      quote: '你的场地申请已经通过审批',
      reason: '只知道已经提交且未收到结果，不能把审批通过当成已知现实条件。',
    },
    expectedScores: {
      good: { goalAlignment: 2, executability: 2, groundedConditions: 2 },
      bad: { goalAlignment: 2, executability: 2, groundedConditions: 0 },
    },
    actionNeed: 'required',
  },
  {
    id: 'action-grounding-invented-resource',
    scenario: {
      question: '我要给活动做一张封面，手边有没有可用图片还没查。第一步怎么推进？',
      knownFacts: [
        '用户需要制作一张活动封面。',
        '用户尚未检查是否有可用图片。',
        '用户可以查看活动文件夹。',
      ],
      goal: '明确封面素材是否可用并开始整理。',
      review: ['建议需要区分已确认素材与待检查素材。'],
      cards: [],
    },
    goodAnswer:
      '先打开活动文件夹，看看有没有可用图片；找到就把候选图放进一个单独文件夹，没有就先记下缺少图片这一项。',
    badAnswer:
      '活动文件夹里已经有一套可用图片。\n先打开活动文件夹，把这些现成图片放进一个单独文件夹。',
    expectedFailure: {
      dimension: 'groundedConditions',
      quote: '活动文件夹里已经有一套可用图片',
      reason: '用户明确尚未检查素材，回答却凭空断言已存在一套可用图片。',
    },
    expectedScores: {
      good: { goalAlignment: 2, executability: 2, groundedConditions: 2 },
      bad: { goalAlignment: 2, executability: 2, groundedConditions: 0 },
    },
    actionNeed: 'required',
  },
  {
    id: 'action-grounding-message-presupposition',
    scenario: {
      question:
        '我想发消息问合作方是否愿意试用这个新流程，只介绍过流程，还没征求过意见。可以怎么开头？',
      knownFacts: [
        '用户已经向合作方介绍过新流程。',
        '用户尚未询问合作方是否愿意试用。',
        '合作方没有表达过是否愿意试用。',
      ],
      goal: '发出征求试用意愿的消息。',
      review: ['检查推荐话术是否准确反映双方已经发生的沟通。'],
      cards: [],
    },
    goodAnswer:
      '可以这样开头：“上次介绍的新流程，你愿意安排一次试用吗？如果愿意，我们再一起确定时间。”',
    badAnswer:
      '可以这样开头：\n“你上次说很期待试用新流程。\n现在愿意安排一次试用吗？如果愿意，我们再一起确定时间。”',
    expectedFailure: {
      dimension: 'groundedConditions',
      quote: '你上次说很期待试用新流程',
      reason: '即使出现在推荐话术中，也把对方没有表达过的试用态度写成已发生的发言。',
    },
    expectedScores: {
      good: { goalAlignment: 2, executability: 2, groundedConditions: 2 },
      bad: { goalAlignment: 2, executability: 2, groundedConditions: 0 },
    },
    actionNeed: 'required',
  },
  {
    id: 'action-grounding-conditional-access',
    scenario: {
      question: '我想修正文档标题，不知道自己有没有编辑权限。我能打开文档并联系所有者，先做什么？',
      knownFacts: [
        '用户可以打开文档并联系所有者。',
        '用户尚不知道自己是否具有编辑权限。',
        '当前目标是修正文档标题。',
      ],
      goal: '根据实际权限推进文档标题修正。',
      review: ['检查未知权限是否被保留为需确认的条件。'],
      cards: [],
    },
    goodAnswer:
      '先打开文档查看能否编辑标题：可以编辑就修正并保存；如果只有查看权限，就把新标题发给所有者，请他修改或开通权限。',
    badAnswer: '所有者已经给你开通了编辑权限。\n先打开文档，把标题修正后保存。',
    expectedFailure: {
      dimension: 'groundedConditions',
      quote: '所有者已经给你开通了编辑权限',
      reason: '题目只提供权限未知，不能断言所有者已经授权；好答案的条件分支没有编造权限。',
    },
    expectedScores: {
      good: { goalAlignment: 2, executability: 2, groundedConditions: 2 },
      bad: { goalAlignment: 2, executability: 2, groundedConditions: 0 },
    },
    actionNeed: 'required',
  },
];
