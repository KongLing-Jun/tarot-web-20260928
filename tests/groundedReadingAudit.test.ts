import { describe, expect, it } from 'vitest';
import {
  buildGroundingAuditMessages,
  parseGroundingAudit,
} from '../scripts/grounded-reading-audit';
import { groundedReadingAuditCases } from './fixtures/grounded-reading-audit';
import { GroundedReadingDecoder } from '../lib/api/reading-grounding';

describe('offline grounded reading semantic audit', () => {
  const fixture = () => groundedReadingAuditCases[0];
  const review = () =>
    fixture().records.map((record, index) => ({
      id: record.id,
      verdict: index === 0 ? 'within-scope' : 'unsupported',
      reason: '明确指出主张与用户原话的关系。',
    }));

  it('separates instructions from source material and never sends expected labels to the reviewer', () => {
    for (const item of groundedReadingAuditCases) {
      const messages = buildGroundingAuditMessages(item.context, item.records);
      expect(messages.map((message) => message.role)).toEqual(['system', 'user']);
      expect(JSON.parse(messages[1].content)).toEqual({
        context: item.context,
        records: item.records,
      });
      expect(messages[1].content).not.toMatch(/expectedVerdicts|expectedReason/);
      expect(messages[0].content).toContain('引用存在不等于推论成立');
      expect(messages[0].content).toContain('有边界的象征倾向');
      expect(messages[0].content).toContain('只分类，不改写');
      expect(messages[0].content).toContain('每条都必须检查文字中的事件断言');
      expect(messages[0].content).toContain('record.kind=symbol');
      expect(messages[0].content).toContain('已知阶段与未知原因必须分开判断');
    }
  });

  it('accepts a complete assessment and reports model assessment rather than factual proof', () => {
    const result = parseGroundingAudit(JSON.stringify({ claims: review() }), fixture().records);
    expect(result).toEqual({ semanticModelAssessment: { claims: review(), passed: false } });
    const allWithin = review().map((claim) => ({ ...claim, verdict: 'within-scope' }));
    expect(
      parseGroundingAudit(JSON.stringify({ claims: allWithin.reverse() }), fixture().records)
        .semanticModelAssessment,
    ).toEqual({ claims: allWithin, passed: true });
  });

  it.each([
    ['missing', () => ({ claims: review().slice(0, 1) })],
    [
      'unknown',
      () => ({
        claims: review().map((claim, index) => (index ? { ...claim, id: 'unknown' } : claim)),
      }),
    ],
    ['duplicate', () => ({ claims: [review()[0], review()[0]] })],
    [
      'invalid verdict',
      () => ({ claims: review().map((claim) => ({ ...claim, verdict: 'probably' })) }),
    ],
    ['empty reason', () => ({ claims: review().map((claim) => ({ ...claim, reason: ' ' })) })],
    [
      'extra claim key',
      () => ({ claims: review().map((claim) => ({ ...claim, rewritten: '替换答案' })) }),
    ],
    ['extra root key', () => ({ claims: review(), passed: true })],
    ['nonobject', () => review()],
  ])('rejects %s instead of silently accepting a partial or edited assessment', (_name, value) => {
    expect(() => parseGroundingAudit(JSON.stringify(value()), fixture().records)).toThrow();
  });

  it('rejects malformed, fenced and empty assessments and ambiguous input IDs', () => {
    for (const text of ['{', 'null', '```json\n{"claims":[]}\n```']) {
      expect(() => parseGroundingAudit(text, fixture().records)).toThrow();
    }
    expect(() => parseGroundingAudit('{"claims":[]}', [])).toThrow();
    const duplicate = [fixture().records[0], fixture().records[0]];
    expect(() => buildGroundingAuditMessages(fixture().context, duplicate)).toThrow();
    expect(() => parseGroundingAudit(JSON.stringify({ claims: review() }), duplicate)).toThrow();
  });

  it('calibrates with structurally valid positive and negative claims, including true quotes with unsupported implications', () => {
    expect(groundedReadingAuditCases).toHaveLength(6);
    for (const item of groundedReadingAuditCases) {
      expect(Object.values(item.expectedVerdicts)).toEqual(['within-scope', 'unsupported']);
      const decoder = new GroundedReadingDecoder(item.context);
      for (const record of item.records) {
        const { type, section, kind, text, users, cards } = record;
        const claim = { type, section, kind, text, users, cards };
        expect(() => decoder.push(`${JSON.stringify(claim)}\n`)).not.toThrow();
      }
      decoder.push('{"type":"end"}\n');
      expect(() => decoder.finish()).not.toThrow();
      expect(decoder.records).toHaveLength(2);
    }
    const corrected = groundedReadingAuditCases.find((item) => item.id === 'latest-correction')!;
    expect(JSON.stringify(corrected.context)).not.toContain('你们其实一直深爱彼此');
    expect(corrected.context.users.at(-1)?.text).toBe('我不想复合，只想取回东西。');
  });

  it('includes subtle diagnostic pairs whose shared valid references cannot establish completed progress, process causes or hidden motives', () => {
    const diagnosticIds = [
      'past-symbol-is-not-completed-preparation',
      'process-stage-does-not-reveal-cause',
      'symbolic-prefix-does-not-establish-inner-motive',
    ];
    for (const id of diagnosticIds) {
      const item = groundedReadingAuditCases.find((fixture) => fixture.id === id)!;
      expect(item.records[0].cards).toEqual(item.records[1].cards);
      expect(item.records[0].users).toEqual(item.records[1].users);
      expect(item.expectedVerdicts).toEqual({
        'claim:0': 'within-scope',
        'claim:1': 'unsupported',
      });
      expect(item.records.every((record) => record.verification === 'references-only')).toBe(true);
      const input = buildGroundingAuditMessages(item.context, item.records)[1].content;
      expect(input).not.toContain(item.expectedReason);
    }
  });
});
