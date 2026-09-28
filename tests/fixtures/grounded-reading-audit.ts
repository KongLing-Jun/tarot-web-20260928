import {
  createReadingEvidence,
  type CheckedGroundedClaim,
  type ReadingEvidenceContext,
} from '../../lib/api/reading-grounding';
import { allCards } from '../../lib/tarot/cards';
import { getSpreadById } from '../../lib/tarot/spreads';
import type { DrawnCard } from '../../lib/tarot/types';

const draw: DrawnCard = {
  card: allCards[0],
  isReversed: true,
  position: { id: 'current', name: 'Present', nameCn: '现在', description: '当前象征主题' },
};
const record = (
  id: string,
  text: string,
  userId: string,
  quote: string,
  kind: 'inference' | 'advice' = 'inference',
): CheckedGroundedClaim => ({
  id,
  type: 'claim',
  section: 'core',
  kind,
  text,
  users: [{ id: userId, quote }],
  cards: ['original:0'],
  verification: 'references-only',
});
const symbol = (id: string, text: string, card: string): CheckedGroundedClaim => ({
  id,
  type: 'claim',
  section: 'core',
  kind: 'symbol',
  text,
  users: [],
  cards: [card],
  verification: 'references-only',
});
const contractQuestion = '客户已确认需求和预算，合同还在审批，本月能签下来吗？';
const contractCards: DrawnCard[] = ['星币8', '宝剑2', '太阳'].map((name, index) => ({
  card: allCards.find((card) => card.nameCn === name)!,
  isReversed: index === 1,
  position: getSpreadById('three-card')!.positions[index],
}));

interface GroundingAuditFixture {
  id: string;
  context: ReadingEvidenceContext;
  records: CheckedGroundedClaim[];
  expectedVerdicts: Record<string, 'within-scope' | 'unsupported'>;
  expectedReason: string;
}

/** Synthetic calibration pairs only; labels must never be included in reviewer messages. */
export const groundedReadingAuditCases: GroundingAuditFixture[] = [
  {
    id: 'one-meeting-is-not-history',
    context: createReadingEvidence({
      question: '我们周三约了一次见面，怎么开口比较好？',
      drawnCards: [draw],
    }),
    records: [
      record(
        'claim:0',
        '可以当面先说：“今天想和你平静聊聊各自的期待。”这是给周三见面的开场建议。',
        'user:0',
        '周三约了一次见面',
        'advice',
      ),
      record(
        'claim:1',
        '你们多次见面已经建立了信任，所以他愿意向你敞开心扉。',
        'user:0',
        '周三约了一次见面',
      ),
    ],
    expectedVerdicts: { 'claim:0': 'within-scope', 'claim:1': 'unsupported' },
    expectedReason:
      '一次未来约见不能证明多次过去相处、信任或对方心理；未来建议不应被误判成既有事实。',
  },
  {
    id: 'latest-correction',
    context: createReadingEvidence({
      question: '我想复合。',
      drawnCards: [draw],
      history: [
        {
          question: '周三约了取东西。',
          interpretation: '你们其实一直深爱彼此。',
          additionalCards: [],
        },
      ],
      followUpQuestion: '我不想复合，只想取回东西。',
    }),
    records: [
      record(
        'claim:0',
        '这次只处理物品交接，可以直接确认地点和取回的物品。',
        'user:2',
        '我不想复合，只想取回东西。',
        'advice',
      ),
      record(
        'claim:1',
        '你真正想要的仍是复合，你们一直深爱彼此，只是暂时不肯承认。',
        'user:0',
        '我想复合。',
      ),
    ],
    expectedVerdicts: { 'claim:0': 'within-scope', 'claim:1': 'unsupported' },
    expectedReason:
      '旧引用仍真实但被最新目标纠正覆盖；历史模型的关系猜测不属于用户事实，也不能凌驾于自述。',
  },
  {
    id: 'process-stage-and-symbolic-boundary',
    context: createReadingEvidence({
      question: '只确认了需求和预算，还能推进合同吗？',
      drawnCards: [draw],
    }),
    records: [
      record(
        'claim:0',
        '从现在位愚者逆位的象征看，更适合先审慎确认下一步，而不是直接冒进；这个倾向不能说明合同审批到了哪一步。',
        'user:0',
        '只确认了需求和预算',
      ),
      record(
        'claim:1',
        '需求和预算已确认，说明条款也已做实、内部审批已经通过，你现在只是焦虑过度。',
        'user:0',
        '只确认了需求和预算',
      ),
    ],
    expectedVerdicts: { 'claim:0': 'within-scope', 'claim:1': 'unsupported' },
    expectedReason:
      '允许基于实际现在位、逆位的有边界象征倾向；确认需求预算不蕴含条款与审批完成，也不证明焦虑。',
  },
  {
    id: 'past-symbol-is-not-completed-preparation',
    context: createReadingEvidence({
      question: contractQuestion,
      spreadId: 'three-card',
      drawnCards: contractCards,
    }),
    records: [
      symbol(
        'claim:0',
        '过去位星币8正位将回看的重点放在细节投入与打磨程度，可用来核对准备工作是否充分，而不是断言它已经完成。',
        'original:0',
      ),
      symbol('claim:1', '前期的细致投入和反复打磨已经完成，为签约打下了扎实的基础。', 'original:0'),
    ],
    expectedVerdicts: { 'claim:0': 'within-scope', 'claim:1': 'unsupported' },
    expectedReason:
      '两条都标为symbol且引用实际过去位；后者仍断言准备完成及现实基础，用户未提供，勤奋牌义不能证明这些进展。',
  },
  {
    id: 'process-stage-does-not-reveal-cause',
    context: createReadingEvidence({
      question: contractQuestion,
      spreadId: 'three-card',
      drawnCards: contractCards,
    }),
    records: [
      {
        ...record(
          'claim:0',
          '现在位宝剑2逆位提示把观察重点放在信息是否足够清楚；可以询问审批还缺什么，但目前无法由已知阶段确认它受阻的原因。',
          'user:0',
          '客户已确认需求和预算，合同还在审批',
        ),
        cards: ['original:1'],
      },
      {
        ...record(
          'claim:1',
          '当前主要变量不在客户意愿，而在审批流程中的信息是否充分透明。',
          'user:0',
          '客户已确认需求和预算，合同还在审批',
        ),
        cards: ['original:1'],
      },
    ],
    expectedVerdicts: { 'claim:0': 'within-scope', 'claim:1': 'unsupported' },
    expectedReason:
      '允许建议核实信息，但用户只提供审批阶段，未说明原因；不能据此排除意愿变化或把信息透明程度确定为主要变量。',
  },
  {
    id: 'symbolic-prefix-does-not-establish-inner-motive',
    context: createReadingEvidence({
      question: '对方说周三可以一起吃饭，我想知道他有没有兴趣。',
      spreadId: 'relationship',
      drawnCards: [
        {
          card: allCards.find((card) => card.nameCn === '宝剑国王')!,
          isReversed: false,
          position: getSpreadById('relationship')!.positions[1],
        },
      ],
    }),
    records: [
      symbol(
        'claim:0',
        '对方感受位的宝剑国王正位偏向理性与边界的主题，因此牌面没有强烈的浪漫倾向；这不能代替对方真实感受的确认。',
        'original:0',
      ),
      symbol(
        'claim:1',
        '从宝剑国王的理性象征看，他在把对你的好感压在理性判断之下，暂时不愿把真实态度交出来。',
        'original:0',
      ),
    ],
    expectedVerdicts: { 'claim:0': 'within-scope', 'claim:1': 'unsupported' },
    expectedReason:
      '有边界的牌面兴趣倾向可以给出；象征开头并不能证明对方已有好感、主动压抑或隐瞒态度。',
  },
];
