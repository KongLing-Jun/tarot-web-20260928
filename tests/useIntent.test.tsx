import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIntent } from '@/hooks/useIntent';
import { IntentFeedback } from '@/components/question/IntentFeedback';
import type { IntentSnapshot } from '@/lib/intent/types';

function snapshot(mode: IntentSnapshot['plan']['mode'] = 'reading'): IntentSnapshot {
  return {
    id: 'intent-1',
    version: 1,
    revision: 1,
    question: '明天面试如何准备',
    messages: [],
    candidate: {
      task: 'prepare',
      turnAction: 'new',
      subject: null,
      goal: null,
      facts: [],
      constraints: [],
      wantsAdvice: true,
      missingInformation: [],
    },
    plan: {
      mode,
      includeAction: true,
      reuseExistingCards: false,
      clarification: mode === 'clarify' ? '你要比较的两个选项是什么？' : null,
    },
  };
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('useIntent', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each(['reading', 'clarify'] as const)('returns and retains the %s response', async (mode) => {
    const next = snapshot(mode);
    fetchMock.mockResolvedValue(Response.json(next));
    const { result } = renderHook(() => useIntent());
    const request = {
      question: next.question,
      sceneId: 'preparation',
      previousIntentId: 'previous',
    };
    let returned;
    await act(async () => {
      returned = await result.current.analyze(request);
    });
    expect(returned).toEqual(next);
    expect(result.current.snapshot).toEqual(next);
    expect(result.current.busy).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/intent',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(request),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('keeps internal errors private and permits a retry', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: 'secret internal URL' }, { status: 500 }),
    );
    fetchMock.mockResolvedValueOnce(Response.json(snapshot()));
    const { result } = renderHook(() => useIntent());
    await act(async () => {
      expect(await result.current.analyze({ question: '问题' })).toBeNull();
    });
    expect(result.current.error).toContain('重试');
    expect(result.current.error).not.toContain('secret');
    await act(async () => {
      await result.current.analyze({ question: '问题' });
    });
    expect(result.current.error).toBeNull();
    expect(result.current.snapshot).not.toBeNull();
  });

  it('deduplicates concurrent requests until the outstanding request resolves', async () => {
    const wait = deferredResponse();
    fetchMock.mockReturnValue(wait.promise);
    const { result } = renderHook(() => useIntent());
    let first!: Promise<IntentSnapshot | null>;
    act(() => {
      first = result.current.analyze({ question: '问题' });
    });
    await act(async () => {
      expect(await result.current.analyze({ question: '问题' })).toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(true);
    await act(async () => {
      wait.resolve(Response.json(snapshot()));
      await first;
    });
    expect(result.current.busy).toBe(false);
  });

  it('reset aborts and discards a late response without clearing a newer pending request', async () => {
    const old = deferredResponse();
    const next = deferredResponse();
    fetchMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const { result } = renderHook(() => useIntent());
    let first!: Promise<IntentSnapshot | null>;
    let second!: Promise<IntentSnapshot | null>;
    act(() => {
      first = result.current.analyze({ question: '旧问题' });
    });
    const signal = fetchMock.mock.calls[0][1].signal;
    act(() => {
      result.current.reset();
    });
    expect(signal.aborted).toBe(true);
    expect(result.current.busy).toBe(false);
    act(() => {
      second = result.current.analyze({ question: '新问题' });
    });
    await act(async () => {
      old.resolve(Response.json(snapshot()));
      expect(await first).toBeNull();
    });
    expect(result.current.busy).toBe(true);
    expect(result.current.snapshot).toBeNull();
    await act(async () => {
      expect(await result.current.analyze({ question: '新问题' })).toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      next.resolve(Response.json(snapshot()));
      await second;
    });
  });

  it('a different request cancels the previous request', async () => {
    const old = deferredResponse();
    fetchMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce(Response.json(snapshot()));
    const { result } = renderHook(() => useIntent());
    let first!: Promise<IntentSnapshot | null>;
    act(() => {
      first = result.current.analyze({ question: '旧问题' });
    });
    const signal = fetchMock.mock.calls[0][1].signal;
    await act(async () => {
      await result.current.analyze({ question: '新问题' });
    });
    expect(signal.aborted).toBe(true);
    await act(async () => {
      old.resolve(Response.json(snapshot('clarify')));
      expect(await first).toBeNull();
    });
    expect(result.current.snapshot?.plan.mode).toBe('reading');
  });

  it('unmount cancels and makes pending responses unusable to callers', async () => {
    const wait = deferredResponse();
    fetchMock.mockReturnValue(wait.promise);
    const { result, unmount } = renderHook(() => useIntent());
    let pending!: Promise<IntentSnapshot | null>;
    act(() => {
      pending = result.current.analyze({ question: '问题' });
    });
    const signal = fetchMock.mock.calls[0][1].signal;
    unmount();
    expect(signal.aborted).toBe(true);
    wait.resolve(Response.json(snapshot()));
    expect(await pending).toBeNull();
  });

  it('presents clarification in the original input flow', () => {
    render(<IntentFeedback busy={false} error={null} snapshot={snapshot('clarify')} />);
    expect(screen.getByRole('status')).toHaveTextContent('你要比较的两个选项是什么？');
    expect(screen.getByRole('status')).toHaveTextContent('请在原输入中补充');
  });

  it('retains clarification context through edits but clears it on a full reset', async () => {
    fetchMock.mockImplementation(async () => Response.json(snapshot('clarify')));
    const { result } = renderHook(() => useIntent());
    await act(async () => {
      await result.current.analyze({ question: '如何选择', sceneId: 'two-options' });
    });
    act(() => {
      result.current.invalidate();
    });
    expect(result.current.snapshot).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.busy).toBe(false);
    await act(async () => {
      await result.current.analyze({ question: 'A还是B', sceneId: 'two-options' });
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      previousIntentId: 'intent-1',
    });
    act(() => {
      result.current.reset();
    });
    await act(async () => {
      await result.current.analyze({ question: '新问题', sceneId: 'two-options' });
    });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).not.toHaveProperty('previousIntentId');
  });

  it.each([
    { sceneId: 'preparation', readingId: 'reading-1' },
    { sceneId: 'two-options', readingId: 'reading-2' },
  ])('does not inherit context across scopes: %j', async (scope) => {
    fetchMock.mockImplementation(async () => Response.json(snapshot('clarify')));
    const { result } = renderHook(() => useIntent());
    await act(async () => {
      await result.current.analyze({
        question: '问题',
        sceneId: 'two-options',
        readingId: 'reading-1',
      });
    });
    act(() => {
      result.current.invalidate();
    });
    await act(async () => {
      await result.current.analyze({ question: '新问题', ...scope });
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty('previousIntentId');
  });

  it('honors an explicitly provided previous intent over remembered context', async () => {
    fetchMock.mockImplementation(async () => Response.json(snapshot('clarify')));
    const { result } = renderHook(() => useIntent());
    await act(async () => {
      await result.current.analyze({ question: '问题' });
    });
    act(() => {
      result.current.invalidate();
    });
    await act(async () => {
      await result.current.analyze({ question: '补充问题', previousIntentId: 'explicit-id' });
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).previousIntentId).toBe('explicit-id');
  });
});
