import { describe, expect, it } from 'vitest';
import { classifyGeneration, hasValidAnswer } from '@/lib/api/generation-result';

describe('generation result contract', () => {
  it.each([
    '',
    '  ',
    '<think>推理</think>',
    '<think>未结束的推理',
    '## 核心解读\n\n## 可采取的行动\n## 各牌说明',
  ])('does not accept empty body %s', (fullText) => {
    expect(hasValidAnswer(fullText)).toBe(false);
    expect(classifyGeneration({ fullText, done: true })).toBe('no-valid-answer');
  });
  it.each([
    [{ done: true }, 'completed'],
    [{ finishReason: 'stop' }, 'completed'],
    [{ finishReason: 'length', done: true }, 'truncated'],
    [{ finishReason: 'content_filter', done: true }, 'interrupted'],
    [{ finishReason: 'tool_calls', done: true }, 'interrupted'],
    [{}, 'interrupted'],
    [{ interrupted: true, done: true }, 'interrupted'],
    [{ cancelled: true, done: true }, 'cancelled'],
  ] as const)('classifies terminal evidence %j as %s', (evidence, expected) => {
    expect(classifyGeneration({ fullText: '<think>推理</think>具体正文', ...evidence })).toBe(
      expected,
    );
  });
});
