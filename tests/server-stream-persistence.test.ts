// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/interpret/route';

const { query } = vi.hoisted(() => ({
  query: vi.fn<(sql: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>>(
    async () => ({ rows: [], rowCount: 1 }),
  ),
}));
vi.mock('@/lib/server/database', () => ({
  transaction: (work: (client: unknown) => unknown) => work({ query }),
}));
vi.mock('@/lib/server/auth', () => ({ requireUser: async () => ({ id: 'test-user' }) }));
vi.mock('@/lib/server/daily', () => ({
  dailyDate: (date: string) => date,
  ensureDailyEntry: vi.fn(),
}));
vi.mock('@/lib/api/server-config', () => ({
  getModelConfig: () => ({
    endpoint: 'https://model.example.invalid',
    model: 'test-model',
    apiKey: 'test-key',
  }),
  getServerNumber: () => 100,
  getModelGenerationOptions: () => ({}),
  getReadingPromptProfile: () => 'p0',
}));
vi.mock('@/lib/api/stream-settings', () => ({
  getStreamSettings: () => ({
    upstreamTimeoutMs: 3000,
    chunkTimeoutMs: 3000,
    heartbeatMs: 1000,
    totalTimeoutMs: 10000,
  }),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('continues forwarding model output when an incremental database write never completes', async () => {
  vi.useFakeTimers();
  query.mockImplementation(async (sql, values) => {
    if (sql.startsWith('UPDATE tarot_chat_messages') && values?.[1] === 'pending') {
      return new Promise(() => {});
    }
    return { rows: [], rowCount: 1 };
  });
  let source: ReadableStreamDefaultController<Uint8Array>;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(ctrl) {
            source = ctrl;
          },
        }),
      ),
    ),
  );
  const response = await POST(
    new NextRequest('http://localhost/api/interpret', {
      method: 'POST',
      body: JSON.stringify({ agent: { prompt: '测试增量保存' } }),
    }),
  );
  const result = response.text();
  await vi.advanceTimersByTimeAsync(2100);
  source!.enqueue(new TextEncoder().encode('data: {"content":"第一段"}\n\n'));
  await vi.advanceTimersByTimeAsync(1);
  expect(
    query.mock.calls.some(
      ([sql, values]) => sql.startsWith('UPDATE tarot_chat_messages') && values?.[1] === 'pending',
    ),
  ).toBe(true);
  source!.enqueue(
    new TextEncoder().encode(
      'data: {"choices":[{"delta":{"content":"第二段"},"finish_reason":"stop"}]}\n\n',
    ),
  );
  await vi.advanceTimersByTimeAsync(3001);
  const output = await result;
  expect(output).toContain('第一段');
  expect(output).toContain('第二段');
  expect(output).toContain('"finish_reason":"stop"');
  expect(output).toContain('"persistence":"failed"');
  expect(output).not.toContain('"error"');
});
