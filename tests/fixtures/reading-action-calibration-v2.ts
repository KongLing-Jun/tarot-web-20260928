import type {
  ReadingActionCalibrationCase,
  ReadingActionScores,
} from './reading-action-calibration';

export interface ReadingActionCalibrationV2Case extends Omit<
  ReadingActionCalibrationCase,
  'expectedScores'
> {
  expectedJointScores: { good: ReadingActionScores[]; bad: ReadingActionScores[] };
  severeErrors: Array<{ id: string; locations: string[] }>;
  source: 'revised-development' | 'new-development';
  annotation: string;
}

// Development calibration only: labels, annotations and error locations stay local.
// Each score object is an allowed joint outcome, not independent per-dimension ranges.
export const readingActionCalibrationV2Cases: ReadingActionCalibrationV2Case[] = [
  {
    id: 'action-goal-rejected-publication',
    source: 'revised-development',
    scenario: {
      question: '我只想把海报初稿整理好给同事看，明确不想公开发布。现在先做什么？',
      knownFacts: [
        '用户已有一张海报初稿。',
        '用户可以编辑初稿、发送给同事，也可以用自己的社交账号发布图片。',
        '本轮只做内部看稿，不公开发布。',
      ],
      goal: '准备可供同事查看的内部海报初稿。',
      review: ['结合当前交付对象、使用范围和可用操作评估回答。'],
      cards: [],
    },
    goodAnswer: '先把初稿导出成一张图片，发给同事，并只问一句：“你第一眼看到的活动名称是什么？”',
    badAnswer: '先把初稿导出成一张图片，发布到自己的公开社交账号，并在文末邀请陌生人转发。',
    expectedFailure: {
      dimension: 'goalAlignment',
      quote: '发布到自己的公开社交账号',
      reason: '公开传播直接违反用户明确拒绝的目标；用户确有操作权限，不能因此再判定动作不可执行。',
    },
    expectedJointScores: {
      good: [{ goalAlignment: 2, executability: 2, groundedConditions: 2 }],
      bad: [{ goalAlignment: 0, executability: 2, groundedConditions: 2 }],
    },
    actionNeed: 'required',
    severeErrors: [],
    annotation: '拒绝目标归目标维；可编辑和发布已给定。邀请别人转发是请求，不是断言别人会转发。',
  },
  {
    id: 'action-goal-latest-correction',
    source: 'revised-development',
    scenario: {
      question:
        '刚才我说要删重复照片，现在改主意了：一张都保留，只想按活动分文件夹。第一步怎么做？',
      knownFacts: [
        '用户能在设备中创建文件夹、移动和删除照片。',
        '用户最新决定保留全部照片。',
        '当前目标是按活动整理照片。',
      ],
      goal: '在不删除照片的前提下开始按活动分类。',
      review: ['依据当前目标、已经表达的修正和实际操作能力评估回答。'],
      cards: [],
    },
    goodAnswer:
      '先建一个以某次活动命名的文件夹，把确认属于那次活动的照片移进去；暂时不确定的先留在原处。',
    badAnswer: '先按拍摄时间排列照片，把同一分钟内构图相似的照片只留一张，其余删除。',
    expectedFailure: {
      dimension: 'goalAlignment',
      quote: '其余删除',
      reason: '删除执行了用户已撤回的目标，违背最新保留全部照片的要求。',
    },
    expectedJointScores: {
      good: [{ goalAlignment: 2, executability: 2, groundedConditions: 2 }],
      bad: [{ goalAlignment: 0, executability: 2, groundedConditions: 2 }],
    },
    actionNeed: 'required',
    severeErrors: [],
    annotation:
      '删除能力已知；目标错误不等于技术上无法删除。条件选择相似照片不预设一定存在重复照片。',
  },
  {
    id: 'action-goal-listening-only',
    source: 'revised-development',
    scenario: {
      question: '今天演讲卡壳，我有点难受。先别帮我制定练习计划，我只是想把这件事说出来。',
      knownFacts: ['用户今天演讲时卡壳。', '用户感到难受。', '用户目前只想倾诉，不要练习计划。'],
      goal: '回应用户已经表达的感受，为继续倾诉留出空间。',
      review: ['根据本轮需求判断回答是否适合，以及是否需要执行评分。'],
      cards: [],
    },
    goodAnswer: '演讲卡壳让你难受，这件事可以先说出来。你想继续讲，我就在这里听。',
    badAnswer: '现在就制定练习计划：每天把演讲内容讲三遍，再把每次卡壳的位置记录下来。',
    expectedFailure: {
      dimension: 'goalAlignment',
      quote: '现在就制定练习计划',
      reason: '用户只要倾诉并明确拒绝本轮训练计划，回答却强行安排训练。',
    },
    expectedJointScores: {
      good: [{ goalAlignment: 2, executability: null, groundedConditions: 2 }],
      bad: [{ goalAlignment: 0, executability: null, groundedConditions: 2 }],
    },
    actionNeed: 'not-required',
    severeErrors: [],
    annotation: '执行维是否适用由本轮需求固定，不因坏回答自行加入计划而改变；删除原镜子预设。',
  },
  {
    id: 'action-goal-preserve-voice',
    source: 'revised-development',
    scenario: {
      question: '这封感谢信我只想检查错别字，保留自己的语气，不想重写。应该怎么检查？',
      knownFacts: [
        '用户已写完一封感谢信，可以编辑全文。',
        '用户只要求检查错别字。',
        '信的原文没有提供，具体内容和当前语体未知。',
      ],
      goal: '只检查错别字，保留原有内容和语气。',
      review: ['根据提供的信息与允许修改的范围评估建议。'],
      cards: [],
    },
    goodAnswer: '从最后一段往前逐句读，只标记疑似错别字，再逐个核对；不改句式和内容。',
    badAnswer: '先不检查错别字，把全文另写成三句正式的致谢，再用新版替换原文。',
    expectedFailure: {
      dimension: 'goalAlignment',
      quote: '把全文另写成三句正式的致谢',
      reason: '明确跳过查错并重写全文，违背本轮目标及拒绝重写的要求。',
    },
    expectedJointScores: {
      good: [{ goalAlignment: 2, executability: 2, groundedConditions: 2 }],
      bad: [{ goalAlignment: 0, executability: 2, groundedConditions: 2 }],
    },
    actionNeed: 'required',
    severeErrors: [],
    annotation:
      '004 不再声称原信存在口语或个人感受；三句正式致谢是建议的未来形式，不是原文事实。重写步骤可执行，但不服务当前目标。',
  },
  {
    id: 'action-execution-empty-advice',
    source: 'revised-development',
    scenario: {
      question: '我已经写好一封活动邀请，想让收件人知道需要回复是否参加。现在具体改哪一句？',
      knownFacts: ['邀请草稿已经写好。', '用户希望收件人回复是否参加。', '用户可以修改邀请文字。'],
      goal: '使邀请明确要求收件人回复是否参加。',
      review: ['分别评估建议的目标方向和落地步骤。'],
      cards: [],
    },
    goodAnswer:
      '在邀请结尾加一句：“请回复是否参加这次活动。”先把这句话放进去，再检查前文是否有重复的回复要求。',
    badAnswer: '为了让收件人明确回复是否参加，你要提升表达能力，把邀请写得更清晰、更有重点。',
    expectedFailure: {
      dimension: 'executability',
      quote: '提升表达能力',
      reason: '指出了正确的回复目标，但没有给出可开始的修改位置、句子或操作。',
    },
    expectedJointScores: {
      good: [{ goalAlignment: 2, executability: 2, groundedConditions: 2 }],
      bad: [{ goalAlignment: 2, executability: 0, groundedConditions: 2 }],
    },
    actionNeed: 'required',
    severeErrors: [],
    annotation:
      '005 目标维只评方向，坏答明确服务是否参加的回复目标；缺少具体步骤只扣执行，不因没有完成任务再次扣目标。',
  },
  {
    id: 'action-execution-known-device',
    source: 'revised-development',
    scenario: {
      question: '今晚只能用手机，也借不到电脑。我想把文档里三处错字改好，怎么做？',
      knownFacts: [
        '用户今晚只有手机，无法借用电脑。',
        '文档已能用手机上的编辑器打开并保存。',
        '需要修正的三处错字位置已经确定。',
      ],
      goal: '修正文档中已定位的三处错字。',
      review: ['分别检查建议服务的目标与步骤所需资源。'],
      cards: [],
    },
    goodAnswer: '用手机编辑器打开文档，逐一定位三处错字并替换；保存后重新打开，核对三处都已改好。',
    badAnswer:
      '虽然你今晚只有手机且借不到电脑，还是请今晚在电脑上打开桌面编辑器，逐一改好三处错字后保存。',
    expectedFailure: {
      dimension: 'executability',
      quote: '今晚在电脑上打开桌面编辑器',
      reason: '所需电脑明确不可获得，步骤在已知资源限制下无法实施。',
    },
    expectedJointScores: {
      good: [{ goalAlignment: 2, executability: 2, groundedConditions: 2 }],
      bad: [{ goalAlignment: 2, executability: 0, groundedConditions: 2 }],
    },
    actionNeed: 'required',
    severeErrors: [],
    annotation:
      '006 改错目标仍一致；设备是执行限制。坏答承认没有电脑，没有虚构已有电脑，禁止标为严重事实编造。',
  },
  {
    id: 'action-execution-outside-control',
    source: 'revised-development',
    scenario: {
      question:
        '我想问同事愿不愿意和我换班，但一定尊重他自愿，不愿意就算了。我能发消息，不能替他决定。下一步怎么做？',
      knownFacts: [
        '用户可以给同事发消息。',
        '同事尚未表达是否愿意换班。',
        '用户明确拒绝强迫同事，换班需要同事自愿同意。',
        '用户不能控制或替代同事的答复。',
      ],
      goal: '征求同事自愿换班的意愿，并尊重拒绝。',
      review: ['结合双方控制权、沟通目标和用户明确表达的边界评估回答。'],
      cards: [],
    },
    goodAnswer:
      '发消息问：“你愿意和我换这次班吗？不方便也可以直接说。”对方拒绝就结束这次请求，未回复先不按同意安排。',
    badAnswer: '不要接受拒绝。下一步直接让同事必须答应换班，把他的答复变成“同意”。',
    expectedFailure: {
      dimension: 'executability',
      quote: '把他的答复变成“同意”',
      reason: '将他人决定当作用户可直接完成的动作，越过用户控制权。',
    },
    expectedJointScores: {
      good: [{ goalAlignment: 2, executability: 2, groundedConditions: 2 }],
      bad: [{ goalAlignment: 0, executability: 0, groundedConditions: 2 }],
    },
    actionNeed: 'required',
    severeErrors: [],
    annotation:
      '007 有两个独立证据：“不要接受拒绝”违反目标边界；“把他的答复变成同意”越过控制权。建议强迫不是声称已经获同意，事实维不扣。',
  },
  {
    id: 'action-execution-feedback-method',
    source: 'revised-development',
    scenario: {
      question:
        '我有两个说明书标题，两位没看过正文的同事愿意试读。我想知道哪个更容易看懂，具体该怎么收集反馈和判断？',
      knownFacts: [
        '用户有两个候选标题。',
        '两位未读正文的同事愿意分别试读标题。',
        '正文用途是指导新人提交报销申请。',
      ],
      goal: '通过可观察的反馈比较两个标题是否让人理解说明书用途。',
      review: ['评估比较目标、反馈获取步骤及判断依据。'],
      cards: [],
    },
    goodAnswer:
      '先让两位同事各看一个标题，问同一句：“你觉得这份说明书教你做什么？”记下原话，再对照是否提到提交报销申请；如果两边都能说清用途，就先不宣称某个更好。',
    badAnswer: '让两位同事各看一个标题，收集反馈，然后综合判断哪个更容易看懂。',
    expectedFailure: {
      dimension: 'executability',
      quote: '收集反馈，然后综合判断',
      reason: '提供了试读动作，但用户询问的如何收集与如何判断仍含混，不能据此完成关键比较步骤。',
    },
    expectedJointScores: {
      good: [{ goalAlignment: 2, executability: 2, groundedConditions: 2 }],
      bad: [{ goalAlignment: 2, executability: 1, groundedConditions: 2 }],
    },
    actionNeed: 'required',
    severeErrors: [],
    annotation: '存在可开始的步骤，执行为 1 而非 0；不因缺乏判断细节给事实维扣分。',
  },
  {
    id: 'action-grounding-event-stage',
    source: 'revised-development',
    scenario: {
      question:
        '刚才想问什么时候能布置，现在先不安排布置，只确认审批有没有结果。申请已提交，我还没收到结果，该怎么问负责人？',
      knownFacts: [
        '场地申请已提交，用户尚未收到审批结果。',
        '用户可以联系负责人询问。',
        '用户最新目标只确认审批状态，明确暂不安排布置。',
      ],
      goal: '向负责人询问审批是否已有结果。',
      review: ['依据最新需求及已经确认的申请信息评估回答。'],
      cards: [],
    },
    goodAnswer:
      '给负责人发一句：“想确认场地申请现在到哪一步了，是否已有审批结果？”收到状态后再决定后续事项。',
    badAnswer:
      '你的场地申请已经通过审批。\n既然申请已获批，下一步只向负责人询问布置时间，不必再问审批状态。\n给负责人发一句：“请告诉我已获批场地明天可以几点开始布置？”',
    expectedFailure: {
      dimension: 'groundedConditions',
      quote: '你的场地申请已经通过审批',
      reason: '没有审批结果来源，却在陈述、因果前提和推荐话术中将审批通过当成现实。',
    },
    expectedJointScores: {
      good: [{ goalAlignment: 2, executability: 2, groundedConditions: 2 }],
      bad: [{ goalAlignment: 0, executability: 2, groundedConditions: 0 }],
    },
    actionNeed: 'required',
    severeErrors: [
      {
        id: 'approval-already-granted',
        locations: [
          '你的场地申请已经通过审批。',
          '既然申请已获批，下一步只向负责人询问布置时间，不必再问审批状态。',
          '给负责人发一句：“请告诉我已获批场地明天可以几点开始布置？”',
        ],
      },
    ],
    annotation:
      '009 目标 0 来自明确“不必再问审批状态”并转问布置时间；事实 0 来自无来源的获批断言。三个位置均属同一审批编造，只要求命中这一个错误，不强制逐行报三次。全部动作仅为发送询问，没有要求立即开始布置，因此执行2；不因内容失实连带扣执行。',
  },
  {
    id: 'action-grounding-invented-resource',
    source: 'revised-development',
    scenario: {
      question: '我要给活动做一张封面，手边有没有可用图片还没查。第一步先确认素材，该怎么做？',
      knownFacts: [
        '用户需要制作一张活动封面。',
        '用户尚未检查是否有可用图片，图片是否存在及可用均未知。',
        '用户可以打开活动文件夹、查看文件并创建候选文件夹。',
      ],
      goal: '通过实际查看确认封面素材是否可用。',
      review: ['检查素材判断的来源，以及检查步骤如何处理不同结果。'],
      cards: [],
    },
    goodAnswer:
      '先打开活动文件夹查看是否有图片，再核对候选图能否用于这次封面；符合就放入候选文件夹，没有符合的就记下缺少可用图片。',
    badAnswer:
      '活动文件夹里已经有一套可用图片。\n先打开活动文件夹查看是否有图片，再核对候选图能否用于这次封面；符合就放入候选文件夹，没有符合的就记下缺少可用图片。',
    expectedFailure: {
      dimension: 'groundedConditions',
      quote: '活动文件夹里已经有一套可用图片',
      reason: '查看前没有任何素材存在或可用的证据，开头却直接断言已有可用图片。',
    },
    expectedJointScores: {
      good: [{ goalAlignment: 2, executability: 2, groundedConditions: 2 }],
      bad: [{ goalAlignment: 2, executability: 2, groundedConditions: 0 }],
    },
    actionNeed: 'required',
    severeErrors: [
      { id: 'usable-images-already-exist', locations: ['活动文件夹里已经有一套可用图片。'] },
    ],
    annotation:
      '010 两答实际检查和缺失分支相同，因此目标及执行均 2；坏答新增无来源的现实断言，只扣事实。检查动作后续可能纠错，不能反过来证明开头编造合理。',
  },
  {
    id: 'action-grounding-message-presupposition',
    source: 'revised-development',
    scenario: {
      question:
        '我想发消息问合作方是否愿意试用这个新流程，只介绍过流程，还没征求过意见。可以怎么开头？',
      knownFacts: [
        '用户已经向合作方介绍过新流程。',
        '用户尚未询问合作方是否愿意试用。',
        '合作方没有表达过是否愿意试用。',
      ],
      goal: '发出征求试用意愿的消息。',
      review: ['结合已有沟通记录与本轮消息目的评估回答。'],
      cards: [],
    },
    goodAnswer:
      '可以这样开头：“上次介绍的新流程，你愿意安排一次试用吗？如果愿意，我们再一起确定时间。”',
    badAnswer:
      '可以这样开头：\n“你上次说很期待试用新流程。\n现在愿意安排一次试用吗？如果愿意，我们再一起确定时间。”',
    expectedFailure: {
      dimension: 'groundedConditions',
      quote: '你上次说很期待试用新流程',
      reason: '推荐话术把未发生的意愿表达写成合作方已说过的话。',
    },
    expectedJointScores: {
      good: [{ goalAlignment: 2, executability: 2, groundedConditions: 2 }],
      bad: [{ goalAlignment: 2, executability: 2, groundedConditions: 0 }],
    },
    actionNeed: 'required',
    severeErrors: [
      { id: 'partner-expressed-eagerness', locations: ['“你上次说很期待试用新流程。'] },
    ],
    annotation: '提出未来试用邀请不等于虚构同意；只有捏造过去的发言是本例必需命中的事实错误。',
  },
  {
    id: 'action-grounding-conditional-access',
    source: 'revised-development',
    scenario: {
      question: '我想修正文档标题，不知道自己有没有编辑权限。我能打开文档并联系所有者，先做什么？',
      knownFacts: [
        '用户可以打开文档并联系所有者。',
        '用户尚不知道自己是否具有编辑权限。',
        '当前目标是修正文档标题。',
      ],
      goal: '根据实际权限推进文档标题修正。',
      review: ['检查权限判断、操作分支和用户可以控制的步骤。'],
      cards: [],
    },
    goodAnswer:
      '先打开文档查看能否编辑标题：可以编辑就修正并保存；如果只有查看权限，就把新标题发给所有者，请他修改或开通权限。',
    badAnswer:
      '所有者已经给你开通了编辑权限。\n先打开文档查看能否编辑标题：可以编辑就修正并保存；如果只有查看权限，就把新标题发给所有者，请他修改或开通权限。',
    expectedFailure: {
      dimension: 'groundedConditions',
      quote: '所有者已经给你开通了编辑权限',
      reason: '未知权限不支持所有者已经授权这一确定断言。',
    },
    expectedJointScores: {
      good: [{ goalAlignment: 2, executability: 2, groundedConditions: 2 }],
      bad: [{ goalAlignment: 2, executability: 2, groundedConditions: 0 }],
    },
    actionNeed: 'required',
    severeErrors: [
      { id: 'editing-permission-already-granted', locations: ['所有者已经给你开通了编辑权限。'] },
    ],
    annotation:
      '保留完整的实际权限分支，隔离无来源授权断言；好答提出有权限与无权限两种可能，不应被误报为编造。',
  },
  {
    id: 'action-clarification-missing-goal',
    source: 'new-development',
    scenario: {
      question: '手上的事情有点乱，想请你帮我决定下一步先做什么。',
      knownFacts: [
        '用户没有说明有哪些事情，也没有说明优先目标、期限或现有进度。',
        '用户愿意继续对话。',
      ],
      goal: '先明确需要推进的事情与当前目标，再确定下一步。',
      review: ['根据已知信息判断下一步能具体到什么程度。'],
      cards: [],
    },
    goodAnswer:
      '先告诉我你现在最想推进哪一件事，以及希望这一步得到什么结果；确定这两点后，我们再选一个你能马上开始的动作。',
    badAnswer: '你先想清楚，再把事情处理好。',
    expectedFailure: {
      dimension: 'executability',
      quote: '你先想清楚',
      reason: '缺少用于澄清的具体问题或信息项，用户仍不知道从哪里开始说明。',
    },
    expectedJointScores: {
      good: [{ goalAlignment: 2, executability: 2, groundedConditions: 2 }],
      bad: [
        { goalAlignment: 1, executability: 0, groundedConditions: 2 },
        { goalAlignment: 2, executability: 0, groundedConditions: 2 },
      ],
    },
    actionNeed: 'required',
    severeErrors: [],
    annotation:
      '必要澄清本身是当前可控动作，不能因没有直接给业务解决方案扣分。坏答“想清楚”可理解为仍服务澄清目标（目标2），也可理解为未明确回应要厘清哪件事（目标1）；两种理由在调用前允许，但都没有可执行信息项，因此执行必须0，事实必须2。',
  },
  {
    id: 'action-reasonable-waiting',
    source: 'new-development',
    scenario: {
      question:
        '稿件我已检查完，必须等编辑明早反馈后再交。编辑确认明早回复，今晚联系不上，也没有其他待办。今晚该怎么推进？',
      knownFacts: [
        '稿件已检查完成，没有其他已知待办。',
        '提交前必须取得编辑反馈。',
        '编辑已确认明早回复，今晚无法联系。',
        '用户明早可以查看消息，收到反馈后可以修改和提交。',
      ],
      goal: '按先取得编辑反馈、再提交的顺序推进稿件。',
      review: ['结合已完成步骤、必要依赖和时间条件评估行动安排。'],
      cards: [],
    },
    goodAnswer:
      '今晚先停在这里。明早查看编辑消息，收到反馈就按意见处理后提交；若仍未收到，就发消息确认预计回复时间，继续暂缓提交。',
    badAnswer: '先等着，之后看情况再处理稿件。',
    expectedFailure: {
      dimension: 'executability',
      quote: '之后看情况再处理稿件',
      reason: '暂缓本身合理，但没有给出何时恢复、核对什么或依赖未满足时如何处理。',
    },
    expectedJointScores: {
      good: [{ goalAlignment: 2, executability: 2, groundedConditions: 2 }],
      bad: [{ goalAlignment: 2, executability: 1, groundedConditions: 2 }],
    },
    actionNeed: 'required',
    severeErrors: [],
    annotation:
      '合理暂缓不是零行动或执行失败；坏答已有等待动作，因此执行 1 分，缺的是恢复检查节点。',
  },
  {
    id: 'action-grounding-uncertain-permission',
    source: 'new-development',
    scenario: {
      question: '我想修正文档标题，能打开文档并联系所有者，但还没查编辑权限，怎么推进？',
      knownFacts: [
        '用户可以打开文档并联系所有者。',
        '编辑权限未知，没有任何关于已授权或授权概率的信息。',
      ],
      goal: '查明权限后通过自己编辑或请所有者修改来修正标题。',
      review: ['检查回答如何表达未知条件，以及操作是否依赖该判断。'],
      cards: [],
    },
    goodAnswer:
      '编辑权限目前未知。先打开文档确认：能编辑就修正标题并保存；只有查看权限就把新标题发给所有者，请他修改。',
    badAnswer:
      '编辑权限应该是有的，不过还不能确认。\n先打开文档确认：能编辑就修正标题并保存；只有查看权限就把新标题发给所有者，请他修改。',
    expectedFailure: {
      dimension: 'groundedConditions',
      quote: '编辑权限应该是有的，不过还不能确认',
      reason: '无任何来源却倾向于判断有权限，事实边界含混；仍明确未确认，并未确定声称已经授权。',
    },
    expectedJointScores: {
      good: [{ goalAlignment: 2, executability: 2, groundedConditions: 2 }],
      bad: [{ goalAlignment: 2, executability: 2, groundedConditions: 1 }],
    },
    actionNeed: 'required',
    severeErrors: [],
    annotation:
      '新增事实 1 分边界：无来源的倾向判断但明确未确认。实际步骤先核对再分支，所以执行 2；禁止升级为已经授权的严重编造。需人工复核理由是否准确指向这句无来源的倾向判断，不能只凭存在引文判通过。',
  },
  {
    id: 'action-full-reading-embedded-advice',
    source: 'new-development',
    scenario: {
      question:
        '活动方案初稿完成了，负责人还没回复，我也不知道他是否批准。我想先收集他的反馈，再决定要改哪里。这次完整解读能给我一个下一步吗？',
      knownFacts: [
        '用户已有活动方案初稿，可以发送给负责人并修改。',
        '负责人尚未回复，是否批准未知。',
        '用户要先收集反馈，再决定修改内容。',
      ],
      goal: '向负责人发出具体的反馈请求，再依据答复决定修改。',
      review: ['结合完整正文中的陈述和嵌入的做法评估回答。'],
      cards: [],
    },
    goodAnswer:
      '事情怎么看\n你已经有了初稿，现在缺的是负责人的反馈。尚未回复只能说明反馈还没到，不能据此判断认可或反对。\n把初稿发给负责人，附上一句：“请你指出这份方案最需要先调整的一处；如果暂时不能看，也请告诉我方便反馈的时间。”收到答复后再决定改哪里。\n\n留意什么\n把等待反馈与修改草稿分开，暂时没有回复时，先保留初稿，不把猜测当成修改依据。',
    badAnswer:
      '事情怎么看\n你已经有了初稿，现在缺的是负责人的反馈。负责人其实已经批准这份方案。\n把初稿发给负责人，附上一句：“请你指出这份方案最需要先调整的一处；如果暂时不能看，也请告诉我方便反馈的时间。”收到答复后再决定改哪里。\n\n留意什么\n负责人已批准的事实说明这一关已经过了，但你仍可询问具体修改意见。',
    expectedFailure: {
      dimension: 'groundedConditions',
      quote: '负责人其实已经批准这份方案',
      reason: '完整解读正文和结尾均把未知的批准状态写成确定事实；做法本身具体不能免除事实错误。',
    },
    expectedJointScores: {
      good: [{ goalAlignment: 2, executability: 2, groundedConditions: 2 }],
      bad: [{ goalAlignment: 2, executability: 2, groundedConditions: 0 }],
    },
    actionNeed: 'required',
    severeErrors: [
      {
        id: 'plan-already-approved',
        locations: [
          '你已经有了初稿，现在缺的是负责人的反馈。负责人其实已经批准这份方案。',
          '负责人已批准的事实说明这一关已经过了，但你仍可询问具体修改意见。',
        ],
      },
    ],
    annotation:
      '动作嵌入事情怎么看正文，没有独立行动标题，同样应识别。全文评分不能只抽取做法句；两个位置属于同一个审批编造。中间动作仍为可控的询问，不能仅因正文事实错而扣执行。新场景同样只用于开发校准。',
  },
];
