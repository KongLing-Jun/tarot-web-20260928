import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseFollowUps, parseReading, parseReadingPatch } from '@/lib/server/readings';
import { updateReadingInterpretation } from '@/lib/readingStorage';
import { apiFetch } from '@/lib/api/client';
import { getSpreadById } from '@/lib/tarot/spreads';

vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn(), ApiError: class extends Error {} }));
beforeEach(() => vi.resetAllMocks());
const reading = {
  id: 'reading-1',
  question: '问题',
  spread: getSpreadById('single'),
  drawnCards: [],
  interpretation: '完整正文',
  createdAt: '2026-09-15T00:00:00.000Z',
};
const followUp = {
  id: 'followup-1',
  question: '追问',
  status: 'done',
  decision: 'direct',
  additionalCards: [],
  interpretation: '回应',
  error: null,
};

describe('生成状态跨存储往返', () => {
  it.each(['completed', 'truncated', 'interrupted', 'cancelled', 'no-valid-answer'] as const)(
    '保留可选终态 %s，不保留客户端保存真相',
    (generationStatus) => {
      expect(
        parseReading({ ...reading, generationStatus, persistenceStatus: 'saved' }),
      ).toMatchObject({ generationStatus });
      expect(
        parseReading({ ...reading, generationStatus, persistenceStatus: 'saved' }),
      ).not.toHaveProperty('persistenceStatus');
      expect(
        parseFollowUps([{ ...followUp, generationStatus, persistenceStatus: 'saved' }])[0],
      ).toMatchObject({ generationStatus });
      expect(
        parseFollowUps([{ ...followUp, generationStatus, persistenceStatus: 'saved' }])[0],
      ).not.toHaveProperty('persistenceStatus');
      expect(
        parseReadingPatch({ interpretation: '内容', generationStatus, persistenceStatus: 'saved' }),
      ).toEqual({ interpretation: '内容', generationStatus });
    },
  );
  it.each(['running', 'done', 'unknown', '', null, 3])(
    '拒绝客户端非法终态 %s',
    (generationStatus) => {
      expect(() => parseReading({ ...reading, generationStatus })).toThrow();
      expect(() => parseFollowUps([{ ...followUp, generationStatus }])).toThrow();
      expect(() => parseReadingPatch({ interpretation: '内容', generationStatus })).toThrow();
    },
  );
  it.each(['', '  ', '<think>推理而已</think>', '## 核心解读\n## 可采取的行动\n## 各牌说明', '✨'])(
    'completed 必须包含有效正文：%s',
    (interpretation) => {
      expect(() =>
        parseReading({ ...reading, interpretation, generationStatus: 'completed' }),
      ).toThrow();
      expect(() =>
        parseFollowUps([{ ...followUp, interpretation, generationStatus: 'completed' }]),
      ).toThrow();
      expect(() => parseReadingPatch({ interpretation, generationStatus: 'completed' })).toThrow();
    },
  );
  it('状态不能脱离本次正文单独覆盖历史', () => {
    expect(() => parseReadingPatch({ generationStatus: 'completed' })).toThrow();
    expect(() => parseReadingPatch({ followUps: [], generationStatus: 'completed' })).toThrow();
  });
  it('旧记录不虚构完成状态', () => {
    expect(parseReading(reading)).not.toHaveProperty('generationStatus');
    expect(parseFollowUps([followUp])[0]).not.toHaveProperty('generationStatus');
    expect(parseReadingPatch({ interpretation: '旧接口' })).toEqual({ interpretation: '旧接口' });
  });
  it('客户端补存接口第三参写回生成状态且兼容旧调用', async () => {
    await updateReadingInterpretation('reading-1', '完整正文', 'completed');
    expect(JSON.parse(vi.mocked(apiFetch).mock.lastCall![1]!.body as string)).toEqual({
      interpretation: '完整正文',
      generationStatus: 'completed',
    });
    await updateReadingInterpretation('reading-1', '旧调用');
    expect(JSON.parse(vi.mocked(apiFetch).mock.lastCall![1]!.body as string)).toEqual({
      interpretation: '旧调用',
    });
  });
});
