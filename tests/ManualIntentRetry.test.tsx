import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ManualReadingReport } from '@/components/reading/ManualReadingReport';
import { useReading } from '@/hooks/useReading';
import { getSpreadById } from '@/lib/tarot/spreads';
import type { ApiConfig, FollowUp } from '@/lib/tarot/types';
import type { IntentSnapshot } from '@/lib/intent/types';

const askFollowUp = vi.fn(async () => {});
const retryFollowUp = vi.fn(async () => {});
const config: ApiConfig = { endpoint: '', apiKey: '', model: '' };
const previous: FollowUp = {
  id: 'old-followup',
  question: '之前的追问',
  status: 'error',
  decision: 'direct',
  drawCount: 0,
  reason: '',
  additionalCards: [],
  revealedCount: 0,
  interpretation: '',
  error: '上次连接中断',
};
function Report() {
  const reading = useReading(getSpreadById('single'));
  return (
    <ManualReadingReport
      reading={{
        ...reading,
        question: '原问题',
        interpretation: '已完成的解读',
        readingId: 'reading-1',
        followUps: [previous],
        askFollowUp,
        retryFollowUp,
      }}
      config={config}
      available
      unavailable={false}
      intentEnabled
      onRedraw={vi.fn()}
      onNew={vi.fn()}
    />
  );
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('重试旧追问会取消新追问识别，迟到结果不能再发起追问', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  let resolve!: (response: Response) => void;
  let signal: AbortSignal | null | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn((_input: string, options?: RequestInit) => {
      signal = options?.signal;
      return new Promise<Response>((done) => {
        resolve = done;
      });
    }),
  );
  render(<Report />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '新的追问' } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(signal?.aborted).toBe(false);
  expect(screen.getByText('正在梳理你想讨论的问题…')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重试解读（保留原牌）' }));
  expect(retryFollowUp).toHaveBeenCalledWith('old-followup', config);
  expect(signal?.aborted).toBe(true);
  const snapshot: IntentSnapshot = {
    id: 'intent-late',
    version: 1,
    revision: 1,
    question: '新的追问',
    readingId: 'reading-1',
    messages: [],
    candidate: {
      task: 'understand',
      turnAction: 'follow-up',
      subject: null,
      goal: null,
      facts: [],
      constraints: [],
      wantsAdvice: true,
      missingInformation: [],
    },
    plan: { mode: 'reading', includeAction: true, reuseExistingCards: true, clarification: null },
  };
  await act(async () => {
    resolve(Response.json(snapshot));
  });
  expect(askFollowUp).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox')).toHaveValue('新的追问');
});
