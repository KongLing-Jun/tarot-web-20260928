import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamInterpret } from '@/lib/api/stream-client';
import { createSseDecoder, extractDecisionJson } from '@/lib/tarot/sseUtils';

const config = {
  connectTimeoutMs: 100,
  streamIdleTimeoutMs: 100,
  progressTimeoutMs: 100,
  totalTimeoutMs: 1000,
  maxRetries: 0,
  retryBaseMs: 1,
};
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const content = (text: string, finish_reason?: string) =>
  frame({ choices: [{ delta: { content: text }, finish_reason }] });
function response(text: string) {
  return new Response(text, { headers: { 'Content-Type': 'text/event-stream' } });
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('SSE event framing', () => {
  it('supports fragments, CRLF, multiline data, no space, comments and EOF tail', () => {
    const parser = createSseDecoder();
    expect(parser.push(': heartbeat\r\ndata:{"choices":\r')).toEqual([]);
    expect(parser.push('\ndata:[]}\r\n\r\ndata:[DO')).toEqual(['{"choices":\n[]}']);
    expect(parser.push('NE]')).toEqual([]);
    expect(parser.finish()).toEqual(['[DONE]']);
  });
});

describe('strict follow-up decisions', () => {
  it.each([
    '{"decision":"other","drawCount":0,"reason":""}',
    '{"decision":"draw","drawCount":4,"reason":""}',
    '{"decision":"draw","drawCount":"2","reason":""}',
    '{"decision":"direct","drawCount":1,"reason":""}',
    '<think>{"decision":"draw","drawCount":2,"reason":""}</think>',
    '解释 {"decision":"draw","drawCount":2,"reason":""}',
  ])('rejects invalid or non-answer decisions %s', (text) =>
    expect(extractDecisionJson(text)).toBeNull(),
  );
  it('reads the final answer after thinking and a JSON fence', () => {
    expect(
      extractDecisionJson(
        '<think>{"decision":"draw"}</think>\n```json\n{"decision":"direct","drawCount":0,"reason":"已有信息"}\n```',
      ),
    ).toEqual({ decision: 'direct', drawCount: 0, reason: '已有信息' });
  });
});

describe('stream terminal and retry contract', () => {
  it('delivers the first nonblank answer immediately after reasoning and batches later chunks', async () => {
    vi.useFakeTimers();
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const onContent = vi.fn();
    const onThinking = vi.fn();
    const observed: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              source = controller;
            },
          }),
        ),
      ),
    );
    const request = streamInterpret(
      {},
      {
        onContent: (text) => {
          onContent(text);
          observed.push(text);
        },
        onThinking: (text) => {
          onThinking(text);
          observed.push(text);
        },
      },
      config,
    );
    await vi.advanceTimersByTimeAsync(0);
    source.enqueue(
      new TextEncoder().encode(frame({ reasoning_content: '分析牌面' }) + content(' \n')),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(onContent).not.toHaveBeenCalled();
    expect(onThinking).not.toHaveBeenCalled();

    source.enqueue(new TextEncoder().encode(content('先明确下一步。')));
    await vi.advanceTimersByTimeAsync(0);
    expect(onContent.mock.calls.map(([text]) => text).join('')).toBe(' \n先明确下一步。');
    expect(observed.join('')).toBe('<think>\n分析牌面\n</think>\n\n \n先明确下一步。');
    const firstCallbackCount = onContent.mock.calls.length;
    source.enqueue(new TextEncoder().encode(content('依据一。') + content('依据二。')));
    await vi.advanceTimersByTimeAsync(79);
    expect(onContent).toHaveBeenCalledTimes(firstCallbackCount);
    await vi.advanceTimersByTimeAsync(1);
    expect(onContent).toHaveBeenLastCalledWith('依据一。依据二。');
    source.enqueue(
      new TextEncoder().encode(content('结尾。', 'stop') + frame({ persistence: 'saved' })),
    );
    source.close();
    expect(await request).toMatchObject({ generationStatus: 'completed' });
    expect(onContent).toHaveBeenLastCalledWith('结尾。');
  });

  it('flushes pending text on cancellation without leaving a late callback', async () => {
    vi.useFakeTimers();
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const onContent = vi.fn();
    const abort = new AbortController();
    const cancelReader = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              source = controller;
            },
            cancel: cancelReader,
          }),
        ),
      ),
    );
    const request = streamInterpret({}, { onContent }, { ...config, signal: abort.signal });
    const assertion = expect(request).rejects.toMatchObject({ info: { code: 'ABORTED' } });
    await vi.advanceTimersByTimeAsync(0);
    source.enqueue(new TextEncoder().encode(content('首段') + content('保留部分')));
    await vi.advanceTimersByTimeAsync(0);
    expect(onContent).toHaveBeenCalledExactlyOnceWith('首段');
    abort.abort();
    await assertion;
    expect(onContent.mock.calls.map(([text]) => text)).toEqual(['首段', '保留部分']);
    await vi.advanceTimersByTimeAsync(200);
    expect(onContent).toHaveBeenCalledTimes(2);
    expect(cancelReader).toHaveBeenCalled();
  });

  it.each([
    [content('正文') + 'data:[DONE]\n\n', 'completed', false],
    [content('末帧正文', 'stop'), 'completed', false],
    [content('正文'), 'interrupted', true],
    [content('部分正文', 'length') + 'data: [DONE]\n\n', 'truncated', false],
    [
      frame({ choices: [{ delta: { reasoning_content: '只有思考' } }] }) + 'data: [DONE]\n\n',
      'no-valid-answer',
      true,
    ],
    [content('正文') + frame({ error: '断开' }), 'interrupted', true],
  ])('classifies wire response as %s', async (wire, status, receivedError) => {
    const fetch = vi.fn().mockResolvedValue(response(wire));
    vi.stubGlobal('fetch', fetch);
    const result = await streamInterpret({}, {}, config);
    expect(result.generationStatus).toBe(status);
    expect(result.receivedError).toBe(receivedError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('keeps generation completed when persistence fails after DONE', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          response(content('完成正文') + 'data: [DONE]\n\n' + frame({ persistence: 'failed' })),
        ),
    );
    const result = await streamInterpret({}, {}, config);
    expect(result).toMatchObject({
      answer: '完成正文',
      generationStatus: 'completed',
      persistenceStatus: 'failed',
      receivedError: false,
    });
  });
  it('keeps an operation id across transport retries but changes attempt id', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(response(content('回答', 'stop')));
    vi.stubGlobal('fetch', fetch);
    await streamInterpret({}, {}, { ...config, maxRetries: 1 });
    const requests = fetch.mock.calls.map((call) => JSON.parse(call[1].body));
    expect(requests[0].operationId).toBeTruthy();
    expect(requests[1].operationId).toBe(requests[0].operationId);
    expect(requests[1].attemptId).not.toBe(requests[0].attemptId);
  });
  it('does not retry an EOF with partial answer', async () => {
    const fetch = vi.fn().mockResolvedValue(response(content('已显示正文')));
    vi.stubGlobal('fetch', fetch);
    await streamInterpret({}, {}, { ...config, maxRetries: 2 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not retry authentication failure', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    await expect(streamInterpret({}, {}, { ...config, maxRetries: 2 })).rejects.toMatchObject({
      info: { code: 'AUTH_FAILED' },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('retries a premature EOF with reasoning only, within the same operation', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(frame({ reasoning_content: '未形成正文' })))
      .mockResolvedValueOnce(response(content('有效回答', 'stop')));
    vi.stubGlobal('fetch', fetch);
    const result = await streamInterpret({}, {}, { ...config, maxRetries: 1 });
    expect(result.answer).toBe('有效回答');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('does not let heartbeat bytes extend the meaningful progress deadline', async () => {
    vi.useFakeTimers();
    let heartbeat: ReturnType<typeof setInterval>;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                heartbeat = setInterval(
                  () => controller.enqueue(new TextEncoder().encode(': heartbeat\n\n')),
                  10,
                );
              },
              cancel() {
                clearInterval(heartbeat);
              },
            }),
          ),
      ),
    );
    const request = streamInterpret({}, {}, { ...config, progressTimeoutMs: 30 });
    const assertion = expect(request).rejects.toMatchObject({ info: { code: 'TIMEOUT' } });
    await vi.advanceTimersByTimeAsync(40);
    await assertion;
  });
  it('keeps waiting while grounded records arrive without exposing progress as body text', async () => {
    vi.useFakeTimers();
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const onContent = vi.fn();
    const onThinking = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              source = controller;
            },
          }),
        ),
      ),
    );
    const request = streamInterpret(
      {},
      { onContent, onThinking },
      { ...config, progressTimeoutMs: 30 },
    );
    const assertion = expect(request).resolves.toMatchObject({
      answer: '有依据的回答',
      generationStatus: 'completed',
    });
    await vi.advanceTimersByTimeAsync(0);
    for (let index = 0; index < 3; index++) {
      await vi.advanceTimersByTimeAsync(20);
      source.enqueue(new TextEncoder().encode(frame({ groundingProgress: true })));
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(onContent).not.toHaveBeenCalled();
    expect(onThinking).not.toHaveBeenCalled();
    source.enqueue(new TextEncoder().encode(content('有依据的回答', 'stop')));
    source.close();
    await assertion;
  });
  it('still enforces the total deadline when protocol progress never yields an answer', async () => {
    vi.useFakeTimers();
    let interval: ReturnType<typeof setInterval>;
    const onContent = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                interval = setInterval(
                  () =>
                    controller.enqueue(
                      new TextEncoder().encode(frame({ groundingProgress: true })),
                    ),
                  10,
                );
              },
              cancel() {
                clearInterval(interval);
              },
            }),
          ),
      ),
    );
    const request = streamInterpret(
      {},
      { onContent },
      { ...config, progressTimeoutMs: 30, totalTimeoutMs: 55 },
    );
    const assertion = expect(request).rejects.toMatchObject({ info: { code: 'TIMEOUT' } });
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
    expect(onContent).not.toHaveBeenCalled();
  });
  it('cancels the reader and never retries after user cancellation', async () => {
    const cancelReader = vi.fn();
    const abort = new AbortController();
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(new ReadableStream({ cancel: cancelReader })));
    vi.stubGlobal('fetch', fetch);
    const request = streamInterpret({}, {}, { ...config, signal: abort.signal, maxRetries: 2 });
    const assertion = expect(request).rejects.toMatchObject({ info: { code: 'ABORTED' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    abort.abort();
    await assertion;
    expect(cancelReader).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('retains completion if the persistence acknowledgement connection is lost', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(content('已完成正文', 'stop')));
            },
          }),
        ),
      ),
    );
    const request = streamInterpret({}, {}, { ...config, progressTimeoutMs: 30 });
    await vi.advanceTimersByTimeAsync(40);
    expect(await request).toMatchObject({
      generationStatus: 'completed',
      persistenceStatus: 'unknown',
      receivedError: false,
    });
  });
  it('bounds all attempts and backoff by one operation deadline', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValue(new TypeError('network'));
    vi.stubGlobal('fetch', fetch);
    const request = streamInterpret(
      {},
      {},
      { ...config, maxRetries: 5, retryBaseMs: 25, totalTimeoutMs: 40 },
    );
    const assertion = expect(request).rejects.toMatchObject({
      info: { code: 'TIMEOUT', retryable: false },
    });
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('works over a LAN URL without crypto.randomUUID', async () => {
    vi.stubGlobal('crypto', {});
    const fetch = vi.fn().mockResolvedValue(response(content('回答', 'stop')));
    vi.stubGlobal('fetch', fetch);
    await expect(streamInterpret({}, {}, config)).resolves.toMatchObject({
      generationStatus: 'completed',
    });
    expect(JSON.parse(fetch.mock.calls[0][1].body).operationId).toBeTruthy();
  });
  it('rejects invalid server budget settings before starting generation', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ...config, totalTimeoutMs: -1 }));
    vi.stubGlobal('fetch', fetch);
    await expect(streamInterpret({}, {})).rejects.toMatchObject({ info: { code: 'BAD_REQUEST' } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('bounds an HTTP error body that never closes', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(new ReadableStream(), { status: 502 })),
    );
    const request = streamInterpret({}, {}, { ...config, connectTimeoutMs: 30 });
    const assertion = expect(request).rejects.toMatchObject({ info: { code: 'TIMEOUT' } });
    await vi.advanceTimersByTimeAsync(40);
    await assertion;
  });
  it('recognizes user cancellation while reading an HTTP error body', async () => {
    const abort = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(new ReadableStream(), { status: 502 })),
    );
    const request = streamInterpret({}, {}, { ...config, signal: abort.signal });
    const assertion = expect(request).rejects.toMatchObject({
      info: { code: 'ABORTED', retryable: false },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    abort.abort();
    await assertion;
  });
});
