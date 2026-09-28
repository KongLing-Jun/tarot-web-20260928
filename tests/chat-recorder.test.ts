// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { startChatExchange } from '@/lib/server/chat';

const { query } = vi.hoisted(() => ({
  query: vi.fn<
    (
      sql: string,
      values?: unknown[],
    ) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number }>
  >(async () => ({ rows: [] })),
}));
vi.mock('@/lib/server/database', () => ({
  transaction: async (work: (client: unknown) => unknown) => work({ query }),
}));
vi.mock('@/lib/server/daily', () => ({
  dailyDate: (value: string) => value,
  ensureDailyEntry: vi.fn(),
}));

const bytes = (value: string) => new TextEncoder().encode(value);
beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [] });
});

describe('chat recorder completion', () => {
  it.each([
    [
      'thinking only',
      'data: {"choices":[{"delta":{"reasoning_content":"思考"},"finish_reason":"stop"}]}\n\n',
      'error',
    ],
    [
      'truncated answer',
      'data: {"choices":[{"delta":{"content":"尚未完整"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n',
      'error',
    ],
    [
      'final frame body',
      'data: {"choices":[{"delta":{"content":"完整答案"},"finish_reason":"stop"}]}\n\n',
      'done',
    ],
    ['unexpected EOF', 'data: {"choices":[{"delta":{"content":"中断答案"}}]}\n\n', 'error'],
  ])('records %s correctly', async (_label, stream, status) => {
    const recorder = await startChatExchange('user', '问题', {});
    await recorder.append(bytes(stream));
    await recorder.finish();
    const saved = query.mock.calls.find(([sql]) =>
      String(sql).startsWith('UPDATE tarot_chat_messages'),
    );
    expect(saved?.[1]?.[1]).toBe(status);
    if (_label === 'final frame body') expect(saved?.[1]?.[0]).toBe('完整答案');
  });

  it('accepts fragmented multiline SSE and preserves final-frame content', async () => {
    const recorder = await startChatExchange('user', '问题', {});
    const data = bytes(
      'data:{"choices":[\r\ndata:{"delta":{"content":"完整答案"},"finish_reason":"stop"}]}',
    );
    for (const byte of data) await recorder.append(new Uint8Array([byte]));
    await recorder.finish();
    expect(
      query.mock.calls
        .find(([sql]) => sql.startsWith('UPDATE tarot_chat_messages'))?.[1]
        ?.slice(0, 2),
    ).toEqual(['完整答案', 'done']);
  });

  it('reuses a completed operation without creating another transcript', async () => {
    const context = { operationId: 'operation', attemptId: 'attempt-one' };
    await startChatExchange('user', '问题', context);
    const inserted = query.mock.calls.find(([sql]) =>
      sql.startsWith('INSERT INTO tarot_chat_messages'),
    )!;
    const savedContext = JSON.parse(inserted[1]![4] as string);
    query.mockClear();
    query.mockImplementation(async (sql) => ({
      rows: sql.startsWith('SELECT id, exchange_id')
        ? [
            {
              id: 'reply',
              exchange_id: 'exchange',
              content: '已有答案',
              status: 'done',
              context: savedContext,
            },
          ]
        : [],
    }));
    const replay = await startChatExchange('user', '问题', {
      ...context,
      attemptId: 'attempt-two',
    });
    expect(replay.replay).toEqual({ content: '已有答案', status: 'done', finishReason: undefined });
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false);
    await expect(startChatExchange('user', '不同问题', context)).rejects.toThrow(
      '请求标识已用于其他内容',
    );
  });

  it('does not allow a superseded attempt to update a reading', async () => {
    const recorder = await startChatExchange('user', '问题', { readingId: 'reading' });
    query.mockClear();
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    await recorder.append(bytes('data: {"content":"旧答案"}\n\ndata: [DONE]\n\n'));
    await recorder.finish();
    expect(query.mock.calls.some(([sql]) => sql.includes('UPDATE tarot_readings'))).toBe(false);
  });
});
