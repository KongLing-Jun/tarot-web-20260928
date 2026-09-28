import { describe, expect, it, vi } from 'vitest';
import { createGroundedReadingStream } from '@/lib/api/grounded-reading-stream';
import { createReadingEvidence } from '@/lib/api/reading-grounding';
import { allCards } from '@/lib/tarot/cards';
import { getSpreadById } from '@/lib/tarot/spreads';
import { createSseDecoder, parseSseChunk } from '@/lib/tarot/sseUtils';

const encoder = new TextEncoder();
const context = () =>
  createReadingEvidence({
    question: '约好周三见一次面。',
    spreadId: 'single',
    drawnCards: [
      { card: allCards[0], isReversed: false, position: getSpreadById('single')!.positions[0] },
    ],
  });
const claim = (patch = {}) => ({
  type: 'claim',
  section: 'core',
  kind: 'inference',
  text: '按牌面，偏向可以继续了解。',
  users: [],
  cards: ['original:0'],
  ...patch,
});
const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const sse = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const delta = (text: string) => sse({ choices: [{ delta: { content: text } }] });
const stop = sse({ choices: [{ finish_reason: 'stop' }] });
const end = line({ type: 'end' });
const done = 'data: [DONE]\n\n';

function source(text: string, byteChunks = false) {
  const bytes = encoder.encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (byteChunks) for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      else controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let raw = '';
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    raw += decoder.decode(next.value, { stream: true });
  }
  raw += decoder.decode();
  reader.releaseLock();
  const frames = createSseDecoder();
  const events = [...frames.push(raw), ...frames.finish()];
  return {
    raw,
    events,
    parsed: events.map(parseSseChunk),
    content: events.map((data) => parseSseChunk(data).content).join(''),
  };
}

describe('grounded reading SSE adapter', () => {
  it('retains valid text but does not signal completion when explanations omit required positions', async () => {
    const spread = getSpreadById('three-card')!;
    const evidence = createReadingEvidence({
      spreadId: spread.id,
      drawnCards: spread.positions.map((position, index) => ({
        card: allCards[index],
        position,
        isReversed: false,
      })),
    });
    const protocol =
      line(claim()) +
      line(claim({ section: 'cards', kind: 'symbol', text: '第一张牌的象征说明。' })) +
      end;
    const result = await collect(
      createGroundedReadingStream(source(delta(protocol) + stop + done), evidence),
    );
    expect(result.content).toContain('第一张牌的象征说明');
    expect(result.parsed.some((event) => event.error)).toBe(true);
    expect(result.parsed.some((event) => event.finishReason === 'stop')).toBe(false);
    expect(result.events).not.toContain('[DONE]');
  });

  it('validates records across SSE frames and UTF-8 byte boundaries before rendering', async () => {
    const protocol = line(claim()) + end;
    const hook = vi.fn();
    const result = await collect(
      createGroundedReadingStream(
        source(
          delta(protocol.slice(0, 19)) +
            delta(protocol.slice(19, 48)) +
            delta(protocol.slice(48)) +
            stop +
            done,
          true,
        ),
        context(),
        { onProtocolText: hook },
      ),
    );
    expect(result.content).toContain('## 核心解读');
    expect(result.content).toContain('按牌面，偏向可以继续了解。');
    expect(result.parsed.filter((event) => event.finishReason === 'stop')).toHaveLength(1);
    expect(result.events.at(-1)).toBe('[DONE]');
    expect(hook.mock.calls.flat().join('')).toBe(protocol);
    expect(result.raw).not.toContain('original:0');
    expect(result.raw).not.toContain('"type":"claim"');
    expect(result.raw).not.toContain('"type":"end"');
  });

  it('emits progress for incomplete protocol text without treating it as answer text', async () => {
    const result = await collect(
      createGroundedReadingStream(source(delta('{"type":') + done), context()),
    );
    expect(result.events[0]).toBe('{"groundingProgress":true}');
    expect(result.parsed[0].content).toBe('');
    expect(result.content).toBe('');
    expect(result.parsed.some((event) => event.error)).toBe(true);
    expect(result.events).not.toContain('[DONE]');
  });

  it.each([
    ['malformed JSON', '{not-json}\n'],
    ['unknown card reference', line(claim({ cards: ['unknown'] }))],
    [
      'fabricated user quotation',
      line(claim({ users: [{ id: 'user:0', quote: '已经多次约会' }] })),
    ],
    ['truncated record', '{"type":"claim"'],
    ['missing protocol end', ''],
  ])(
    'preserves valid prefixes but rejects %s without reporting successful completion',
    async (_name, invalid) => {
      const result = await collect(
        createGroundedReadingStream(
          source(delta(line(claim()) + invalid) + stop + done),
          context(),
        ),
      );
      expect(result.content).toContain('按牌面，偏向可以继续了解。');
      expect(result.parsed.some((event) => event.error)).toBe(true);
      expect(result.parsed.some((event) => event.finishReason === 'stop' || event.isDone)).toBe(
        false,
      );
      expect(result.raw).not.toContain('已经多次约会');
    },
  );

  it('preserves a length termination without upgrading it to successful completion', async () => {
    const result = await collect(
      createGroundedReadingStream(
        source(delta(line(claim())) + sse({ choices: [{ finish_reason: 'length' }] }) + done),
        context(),
      ),
    );
    expect(result.content).toContain('按牌面');
    expect(result.parsed.some((event) => event.truncated)).toBe(true);
    expect(result.parsed.some((event) => event.isDone || event.finishReason === 'stop')).toBe(
      false,
    );
  });

  it('preserves model, usage after stop, and genuine thinking without forwarding raw envelopes', async () => {
    const usage = { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 };
    const result = await collect(
      createGroundedReadingStream(
        source(
          sse({
            model: 'test-model',
            choices: [{ delta: { reasoning_content: '核对引用。' } }],
            privateData: 'secret',
          }) +
            delta(line(claim()) + end) +
            stop +
            sse({ choices: [], usage }) +
            done,
        ),
        context(),
      ),
    );
    expect(result.parsed.map((event) => event.thinking).join('')).toBe('核对引用。');
    expect(result.events).toContain(JSON.stringify({ model: 'test-model' }));
    expect(result.events).toContain(JSON.stringify({ usage }));
    expect(result.raw).not.toContain('secret');
    expect(result.events.indexOf(JSON.stringify({ usage }))).toBeLessThan(
      result.events.findIndex((data) => parseSseChunk(data).finishReason === 'stop'),
    );
  });

  it.each([
    ['stop with EOF', stop],
    ['DONE without separate stop', done],
  ])('accepts valid protocol with %s', async (_name, terminal) => {
    const result = await collect(
      createGroundedReadingStream(source(delta(line(claim()) + end) + terminal), context()),
    );
    expect(result.events.at(-1)).toBe('[DONE]');
    expect(result.parsed.some((event) => event.error)).toBe(false);
  });

  it.each([
    ['EOF without upstream completion', ''],
    ['unsupported finish reason', sse({ choices: [{ finish_reason: 'content_filter' }] }) + done],
    ['malformed SSE JSON', 'data: {bad-json}\n\n' + done],
    ['upstream error', sse({ error: { message: 'upstream-secret' } }) + done],
    ['content after stop', stop + delta(line(claim())) + done],
  ])('rejects %s and does not leak upstream error data', async (_name, terminal) => {
    const result = await collect(
      createGroundedReadingStream(source(delta(line(claim()) + end) + terminal), context()),
    );
    expect(result.parsed.some((event) => event.error)).toBe(true);
    expect(result.events).not.toContain('[DONE]');
    expect(result.raw).not.toContain('upstream-secret');
  });

  it('converts a network read failure to an error after preserving validated text', async () => {
    let reads = 0;
    const upstream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (reads++ === 0) controller.enqueue(encoder.encode(delta(line(claim()))));
        else controller.error(new Error('private-network-details'));
      },
    });
    const result = await collect(createGroundedReadingStream(upstream, context()));
    expect(result.content).toContain('按牌面');
    expect(result.parsed.some((event) => event.error)).toBe(true);
    expect(result.raw).not.toContain('private-network-details');
    expect(result.events).not.toContain('[DONE]');
    expect(upstream.locked).toBe(false);
  });

  it('propagates cancellation to an upstream reader waiting for further records', async () => {
    const cancel = vi.fn();
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(delta('{"type":')));
      },
      cancel,
    });
    const reader = createGroundedReadingStream(upstream, context()).getReader();
    const progress = await reader.read();
    expect(new TextDecoder().decode(progress.value)).toContain('groundingProgress');
    await reader.cancel('navigation');
    expect(cancel).toHaveBeenCalledWith('navigation');
    expect((await reader.read()).done).toBe(true);
    expect(upstream.locked).toBe(false);
  });
});
