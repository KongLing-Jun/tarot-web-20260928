import { allCards } from '../tarot/cards';
import { getSpreadById } from '../tarot/spreads';
import { getSpreadPositionGuidance } from '../tarot/spread-guidance';
import type { DrawnCard, FollowUpHistoryEntry } from '../tarot/types';

export interface ReadingEvidenceContext {
  mode: 'initial' | 'direct' | 'extras' | 'daily';
  spreadId?: string;
  latestUserId?: string;
  users: { id: string; text: string }[];
  cards: {
    id: string;
    cardName: string;
    position: string;
    perspective: string;
    isReversed: boolean;
    keywords: string[];
  }[];
}
export interface ReadingEvidenceInput {
  question?: string;
  spreadId?: string;
  drawnCards?: DrawnCard[];
  followUpQuestion?: string;
  history?: FollowUpHistoryEntry[];
  additionalCards?: DrawnCard[];
  daily?: { cardName: string; isReversed: boolean; dateStr: string };
}
export interface GroundedClaim {
  type: 'claim';
  section: 'core' | 'action' | 'cards';
  kind: 'quote' | 'symbol' | 'inference' | 'advice';
  text: string;
  users: { id: string; quote: string }[];
  cards: string[];
}
export interface CheckedGroundedClaim extends GroundedClaim {
  id: string;
  /** Reference integrity cannot establish semantic entailment. */
  verification: 'references-only';
}

export interface ReadingCardCoverage {
  status: 'not-required' | 'omitted' | 'complete' | 'incomplete';
  requiredIds: string[];
  explainedIds: string[];
}

export function createReadingEvidence(input: ReadingEvidenceInput): ReadingEvidenceContext {
  const context: ReadingEvidenceContext = {
    mode: input.daily
      ? 'daily'
      : input.followUpQuestion === undefined
        ? 'initial'
        : input.additionalCards
          ? 'extras'
          : 'direct',
    spreadId: input.spreadId,
    users: [],
    cards: [],
  };
  const user = (text: string | undefined) => {
    if (text?.trim()) context.users.push({ id: `user:${context.users.length}`, text });
  };
  const cards = (drawn: DrawnCard[], prefix: string) =>
    drawn.forEach((draw, index) => {
      const card = allCards.find((item) => item.id === draw?.card?.id);
      if (!card || typeof draw.isReversed !== 'boolean' || !draw.position?.nameCn?.trim())
        throw new Error('无效牌面依据');
      const spread =
        prefix === 'original' && input.spreadId ? getSpreadById(input.spreadId) : undefined;
      const position = spread?.positions.find((item) => item.id === draw.position.id);
      if (
        prefix === 'original' &&
        input.spreadId &&
        (!position || drawn.slice(0, index).some((item) => item.position.id === draw.position.id))
      )
        throw new Error('无效牌阵位置');
      context.cards.push({
        id: `${prefix}:${index}`,
        cardName: card.nameCn,
        position: position?.nameCn ?? draw.position.nameCn,
        perspective:
          getSpreadPositionGuidance(position?.id ?? draw.position.id) ??
          '以本轮问题为范围解释牌的象征主题，不补写现实经历或心理。',
        isReversed: draw.isReversed,
        keywords: [...card.keywords[draw.isReversed ? 'reversed' : 'upright']],
      });
    });
  if (input.daily) {
    const card = allCards.find((item) => item.name === input.daily!.cardName);
    if (!card || typeof input.daily.isReversed !== 'boolean') throw new Error('无效每日牌面依据');
    cards(
      [
        {
          card,
          isReversed: input.daily.isReversed,
          position: { id: 'daily', name: 'Daily', nameCn: '今日指引', description: '' },
        },
      ],
      'daily',
    );
  } else {
    user(input.question);
    cards(input.drawnCards ?? [], 'original');
    for (const [index, turn] of (input.history ?? []).entries()) {
      user(turn.question);
      cards(turn.additionalCards, `history:${index}:extra`);
    }
    user(input.followUpQuestion);
    cards(input.additionalCards ?? [], 'current:extra');
  }
  context.latestUserId = context.users.at(-1)?.id;
  return context;
}

const plain = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const escapeMarkdown = (text: string) => text.replace(/[\\`*_{}\[\]()<>#+.!|~-]/g, '\\$&');
const titles = { core: '核心解读', action: '可采取的行动', cards: '各牌说明' };
const order = { core: 0, action: 1, cards: 2 };

/** One complete NDJSON claim at a time; invalid records never become display text. */
export class GroundedReadingDecoder {
  readonly records: CheckedGroundedClaim[] = [];
  private pending = '';
  private ended = false;
  private section: GroundedClaim['section'] | undefined;
  constructor(readonly context: ReadingEvidenceContext) {}

  /** Structural coverage only. Omission can be a valid brief reply, not verified full coverage. */
  get cardCoverage(): ReadingCardCoverage {
    const prefix =
      this.context.mode === 'initial'
        ? 'original:'
        : this.context.mode === 'extras'
          ? 'current:extra:'
          : undefined;
    const requiredIds = prefix
      ? this.context.cards.filter((card) => card.id.startsWith(prefix)).map((card) => card.id)
      : [];
    const explainedIds = this.records
      .filter((record) => record.section === 'cards')
      .flatMap((record) => record.cards);
    const status = !requiredIds.length
      ? 'not-required'
      : !explainedIds.length
        ? 'omitted'
        : requiredIds.every((id) => explainedIds.includes(id))
          ? 'complete'
          : 'incomplete';
    return { status, requiredIds, explainedIds };
  }

  push(delta: string): string {
    this.pending += delta;
    let output = '';
    while (this.pending.includes('\n')) {
      const at = this.pending.indexOf('\n');
      const line = this.pending.slice(0, at).trim();
      this.pending = this.pending.slice(at + 1);
      if (line) output += this.read(line);
    }
    return output;
  }

  finish(): string {
    let output = '';
    if (this.pending.trim()) output = this.read(this.pending.trim());
    this.pending = '';
    if (!this.ended || !this.records.length) throw new Error('依据协议未完整结束');
    if (this.cardCoverage.status === 'incomplete') throw new Error('牌位说明未完整覆盖');
    return output;
  }

  private read(line: string): string {
    if (this.ended) throw new Error('结束标记后仍有内容');
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error('依据协议不是完整JSON记录');
    }
    if (plain(value) && value.type === 'end' && Object.keys(value).length === 1) {
      if (!this.records.length) throw new Error('缺少核心解读');
      this.ended = true;
      return '';
    }
    if (
      !plain(value) ||
      value.type !== 'claim' ||
      typeof value.section !== 'string' ||
      !['core', 'action', 'cards'].includes(value.section) ||
      typeof value.kind !== 'string' ||
      !['quote', 'symbol', 'inference', 'advice'].includes(value.kind) ||
      typeof value.text !== 'string' ||
      !value.text.trim() ||
      !Array.isArray(value.users) ||
      !Array.isArray(value.cards) ||
      Object.keys(value).some(
        (key) => !['type', 'section', 'kind', 'text', 'users', 'cards'].includes(key),
      )
    )
      throw new Error('无效依据记录');
    const claim = value as unknown as GroundedClaim;
    if (
      (!this.section && claim.section !== 'core') ||
      (this.section && order[claim.section] < order[this.section])
    )
      throw new Error('依据章节顺序错误');
    if (/^\s*#{1,6}\s/m.test(claim.text)) throw new Error('章节标题只能由程序生成');
    if (
      new Set(claim.cards).size !== claim.cards.length ||
      claim.cards.some((id) => !this.context.cards.some((card) => card.id === id))
    )
      throw new Error('未知或重复牌位引用');
    for (const ref of claim.users) {
      if (
        !plain(ref) ||
        typeof ref.id !== 'string' ||
        typeof ref.quote !== 'string' ||
        !ref.quote.trim() ||
        Object.keys(ref).some((key) => !['id', 'quote'].includes(key)) ||
        !this.context.users.find((user) => user.id === ref.id)?.text.includes(ref.quote)
      )
        throw new Error('用户原文引用无法核验');
    }
    if (!claim.users.length && !claim.cards.length) throw new Error('缺少依据');
    if (
      claim.kind === 'quote' &&
      (claim.users.length !== 1 || claim.cards.length || claim.text !== claim.users[0].quote)
    )
      throw new Error('事实引用必须逐字保留用户原文');
    if (claim.kind === 'symbol' && (!claim.cards.length || claim.users.length))
      throw new Error('符号解释必须只引用实际牌位');
    if (claim.section === 'cards' && (claim.kind !== 'symbol' || claim.cards.length !== 1))
      throw new Error('各牌说明必须绑定单个实际牌位');
    if (
      claim.section === 'cards' &&
      this.records.some(
        (record) => record.section === 'cards' && record.cards[0] === claim.cards[0],
      )
    )
      throw new Error('重复牌位说明');
    if (claim.section === 'action' && claim.kind !== 'advice')
      throw new Error('行动章节只能包含建议');
    const heading =
      this.context.mode === 'daily' || this.section === claim.section
        ? ''
        : `## ${titles[claim.section]}\n`;
    this.section = claim.section;
    const citedCards = claim.cards.map((id) => this.context.cards.find((card) => card.id === id)!);
    const label = (card: ReadingEvidenceContext['cards'][number]) =>
      `${escapeMarkdown(card.position)}｜${escapeMarkdown(card.cardName)}（${card.isReversed ? '逆位' : '正位'}）`;
    let body =
      claim.kind === 'quote'
        ? `> 你说：“${escapeMarkdown(claim.text).replaceAll('\n', '\n> ')}”`
        : claim.text;
    if (claim.section === 'cards') body = `### ${label(citedCards[0])}\n${body}`;
    else if (citedCards.length) body += `\n\n*牌面依据：${citedCards.map(label).join('；')}*`;
    if (claim.kind !== 'quote')
      for (const ref of claim.users)
        body += `\n\n> 你说：“${escapeMarkdown(ref.quote).replaceAll('\n', '\n> ')}”`;
    this.records.push({
      ...claim,
      id: `claim:${this.records.length}`,
      verification: 'references-only',
    });
    return `${heading}${body}\n\n`;
  }
}
