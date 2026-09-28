import { describe, expect, it } from 'vitest';
import { allCards } from '@/lib/tarot/cards';
import { getSpreadById } from '@/lib/tarot/spreads';
import { createReadingEvidence, GroundedReadingDecoder } from '@/lib/api/reading-grounding';

const card = {
  card: allCards[0],
  isReversed: false,
  position: getSpreadById('single')!.positions[0],
};
const context = () =>
  createReadingEvidence({ question: '约好周三见一次面。', drawnCards: [card], spreadId: 'single' });
const claim = (patch = {}) => ({
  type: 'claim',
  section: 'core',
  kind: 'inference',
  text: '按牌面，偏向可以继续了解。',
  users: [],
  cards: ['original:0'],
  ...patch,
});

describe('reading evidence boundaries', () => {
  it('distinguishes omitted card explanations from complete coverage for a legitimate brief reply', () => {
    const d = new GroundedReadingDecoder(context());
    d.push(JSON.stringify(claim()) + '\n{"type":"end"}\n');
    d.finish();
    expect(d.cardCoverage).toEqual({
      status: 'omitted',
      requiredIds: ['original:0'],
      explainedIds: [],
    });
  });

  it('requires all original positions once card explanations start', () => {
    const spread = getSpreadById('three-card')!;
    const c = createReadingEvidence({
      spreadId: spread.id,
      drawnCards: spread.positions.map((position, i) => ({ ...card, card: allCards[i], position })),
    });
    const d = new GroundedReadingDecoder(c);
    d.push(JSON.stringify(claim()) + '\n');
    d.push(JSON.stringify(claim({ section: 'cards', kind: 'symbol' })) + '\n{"type":"end"}\n');
    expect(d.cardCoverage.status).toBe('incomplete');
    expect(() => d.finish()).toThrow('牌位说明未完整覆盖');
    expect(d.records).toHaveLength(2);
  });

  it('rejects repeated explanations of the same position without rejecting core references to it', () => {
    const d = new GroundedReadingDecoder(context());
    d.push(JSON.stringify(claim()) + '\n');
    const line = JSON.stringify(claim({ section: 'cards', kind: 'symbol' })) + '\n';
    d.push(line);
    expect(() => d.push(line)).toThrow('重复牌位说明');
    expect(d.records).toHaveLength(2);
    expect(d.cardCoverage.status).toBe('complete');
  });

  it('requires current extra positions, not historical repetitions or the full original spread', () => {
    const c = createReadingEvidence({
      question: '原问题',
      drawnCards: [card],
      spreadId: 'single',
      followUpQuestion: '新追问',
      additionalCards: [card],
      history: [{ question: '旧追问', interpretation: '', additionalCards: [card] }],
    });
    const d = new GroundedReadingDecoder(c);
    d.push(JSON.stringify(claim()) + '\n');
    d.push(
      JSON.stringify(claim({ section: 'cards', kind: 'symbol', cards: ['history:0:extra:0'] })) +
        '\n',
    );
    expect(d.cardCoverage.status).toBe('incomplete');
    d.push(
      JSON.stringify(claim({ section: 'cards', kind: 'symbol', cards: ['current:extra:0'] })) +
        '\n{"type":"end"}\n',
    );
    d.finish();
    expect(d.cardCoverage).toMatchObject({ status: 'complete', requiredIds: ['current:extra:0'] });
  });

  it('does not require full card coverage for direct follow-ups or daily reflections', () => {
    const inputs = [
      { ...context(), mode: 'direct' as const },
      createReadingEvidence({
        daily: { cardName: allCards[0].name, isReversed: false, dateStr: '2026-09-21' },
      }),
    ];
    for (const c of inputs) {
      const d = new GroundedReadingDecoder(c);
      d.push(JSON.stringify(claim({ cards: [c.cards[0].id] })) + '\n{"type":"end"}\n');
      d.finish();
      expect(d.cardCoverage.status).toBe('not-required');
    }
  });
  it('binds registered positions by ID instead of trusting request labels', () => {
    const renamed = { ...card, position: { ...card.position, nameCn: '已确认的对方内心' } };
    expect(
      createReadingEvidence({ spreadId: 'single', drawnCards: [renamed] }).cards[0],
    ).toMatchObject({ position: '指引', perspective: expect.any(String) });
    expect(() =>
      createReadingEvidence({
        spreadId: 'single',
        drawnCards: [{ ...card, position: getSpreadById('three-card')!.positions[0] }],
      }),
    ).toThrow('牌阵位置');
    expect(() => createReadingEvidence({ spreadId: 'single', drawnCards: [card, card] })).toThrow(
      '牌阵位置',
    );
    expect(() => createReadingEvidence({ spreadId: 'unknown', drawnCards: [card] })).toThrow(
      '牌阵位置',
    );
  });
  it('retains only user turns as reality sources and distinguishes repeated extra positions', () => {
    const c = createReadingEvidence({
      question: '想复合',
      drawnCards: [card],
      spreadId: 'single',
      followUpQuestion: '不想复合，只取回东西',
      history: [
        { question: '周三见面', interpretation: '对方已经承诺复合', additionalCards: [card] },
      ],
      additionalCards: [{ ...card, isReversed: true }],
    });
    expect(c.users.map((x) => x.text)).toEqual(['想复合', '周三见面', '不想复合，只取回东西']);
    expect(JSON.stringify(c)).not.toContain('已经承诺');
    expect(c.latestUserId).toBe(c.users[2].id);
    expect(c.cards.map((x) => x.id)).toEqual([
      'original:0',
      'history:0:extra:0',
      'current:extra:0',
    ]);
    expect(c.cards[2].isReversed).toBe(true);
  });

  it('waits for a whole record and renders card titles from bound evidence', () => {
    const d = new GroundedReadingDecoder(context());
    const line = JSON.stringify(claim()) + '\n';
    expect(d.push(line.slice(0, 15))).toBe('');
    expect(d.push(line.slice(15))).toContain('## 核心解读');
    const detail = d.push(
      JSON.stringify(
        claim({ section: 'cards', kind: 'symbol', text: '新的起点主题，支持探索的方向。' }),
      ) + '\n',
    );
    expect(detail).toContain('指引｜愚者（正位）');
    d.push('{"type":"end"}\n');
    expect(d.finish()).toBe('');
    expect(d.records).toHaveLength(2);
  });

  it('allows only literal user text for factual quote records', () => {
    const d = new GroundedReadingDecoder(context());
    expect(
      d.push(
        JSON.stringify(
          claim({
            kind: 'quote',
            text: '周三见一次面',
            users: [{ id: 'user:0', quote: '周三见一次面' }],
            cards: [],
          }),
        ) + '\n',
      ),
    ).toContain('周三见一次面');
    expect(() =>
      new GroundedReadingDecoder(context()).push(
        JSON.stringify(
          claim({
            kind: 'quote',
            text: '多次亲密见面',
            users: [{ id: 'user:0', quote: '周三见一次面' }],
            cards: [],
          }),
        ) + '\n',
      ),
    ).toThrow();
  });

  it.each([
    { cards: ['unknown'] },
    { users: [{ id: 'assistant:0', quote: '周三见面' }] },
    { users: [{ id: 'user:0', quote: '多次见面' }] },
    { users: [], cards: [] },
    { kind: 'symbol', cards: [] },
    { kind: ['quote'], text: '伪造事实', users: [{ id: 'user:0', quote: '周三见一次面' }] },
    { section: ['core'] },
    { cardName: '伪造牌名' },
    { section: 'cards', cards: ['original:0', 'original:0'] },
  ])('rejects invalid or unsupported references %j', (patch) => {
    expect(() =>
      new GroundedReadingDecoder(context()).push(JSON.stringify(claim(patch)) + '\n'),
    ).toThrow();
  });

  it('does not confuse a matching quotation with a semantically supported inference', () => {
    const d = new GroundedReadingDecoder(context());
    d.push(
      JSON.stringify(
        claim({ text: '多次相处证明他信任你。', users: [{ id: 'user:0', quote: '周三见一次面' }] }),
      ) + '\n',
    );
    expect(d.records[0].verification).toBe('references-only');
  });

  it('fails closed on truncated records, missing end, or records after end', () => {
    const d = new GroundedReadingDecoder(context());
    d.push(JSON.stringify(claim()) + '\n{"type":');
    expect(() => d.finish()).toThrow();
    const missing = new GroundedReadingDecoder(context());
    missing.push(JSON.stringify(claim()) + '\n');
    expect(() => missing.finish()).toThrow();
    const closed = new GroundedReadingDecoder(context());
    closed.push(JSON.stringify(claim()) + '\n{"type":"end"}\n');
    expect(() => closed.push(JSON.stringify(claim()) + '\n')).toThrow();
  });
});
