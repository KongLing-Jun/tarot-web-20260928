import { GroundedReadingDecoder, type ReadingEvidenceContext } from '@/lib/api/reading-grounding';
import { createSseDecoder, parseSseChunk } from '@/lib/tarot/sseUtils';

/** Only reference-checked records become answer text; semantic correctness is not established here. */
export function createGroundedReadingStream(
  upstream: ReadableStream<Uint8Array>,
  context: ReadingEvidenceContext,
  hooks?: { onProtocolText?: (text: string) => void },
): ReadableStream<Uint8Array> {
  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const frames = createSseDecoder();
  const reading = new GroundedReadingDecoder(context);
  let stopped = false;
  let cancelled = false;
  let sawStop = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const event = (value: unknown) => {
        if (!cancelled) controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
      };
      const content = (text: string) => {
        if (text) event({ content: text });
      };
      const complete = () => {
        content(reading.finish());
        event({ choices: [{ finish_reason: 'stop' }] });
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        stopped = true;
      };
      const forward = (data: string) => {
        if (stopped || cancelled) return;
        const parsed = parseSseChunk(data);
        if (parsed.malformed || parsed.error) throw new Error('Invalid upstream event');
        if (parsed.isDone) {
          complete();
          return;
        }

        // Rebuild a small envelope instead of forwarding raw choices/message objects.
        const payload: unknown = JSON.parse(data);
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          const source = payload as Record<string, unknown>;
          const metadata = {
            ...(typeof source.model === 'string' ? { model: source.model } : {}),
            ...(source.usage && typeof source.usage === 'object' ? { usage: source.usage } : {}),
          };
          if (Object.keys(metadata).length) event(metadata);
        }
        if (parsed.thinking) event({ reasoning_content: parsed.thinking });
        if (parsed.content) {
          if (sawStop) throw new Error('Content after stop');
          event({ groundingProgress: true });
          hooks?.onProtocolText?.(parsed.content);
          // Flush one record at a time so an invalid later record cannot hide a valid prefix.
          for (const part of parsed.content.split(/(?<=\n)/u)) content(reading.push(part));
        }
        if (parsed.truncated) {
          event({ choices: [{ finish_reason: 'length' }] });
          stopped = true;
        } else if (parsed.finishReason) {
          if (parsed.finishReason !== 'stop') throw new Error('Unexpected finish reason');
          sawStop = true;
        }
      };

      void (async () => {
        try {
          while (!stopped && !cancelled) {
            const { done, value } = await reader.read();
            if (cancelled) return;
            if (done) {
              for (const data of [...frames.push(decoder.decode()), ...frames.finish()])
                forward(data);
              if (!stopped) {
                if (!sawStop) throw new Error('Missing upstream completion');
                complete();
              }
              break;
            }
            for (const data of frames.push(decoder.decode(value, { stream: true }))) forward(data);
          }
        } catch {
          if (!cancelled)
            event({
              error: { message: '解读依据校验或传输未完成，已保留通过校验的内容，请重试。' },
            });
        } finally {
          stopped = true;
          await reader.cancel().catch(() => {});
          reader.releaseLock();
          if (!cancelled) controller.close();
        }
      })();
    },
    async cancel(reason) {
      cancelled = true;
      stopped = true;
      await reader.cancel(reason).catch(() => {});
    },
  });
}
