vi.mock('@/hooks/useApiConfig', () => ({
  useApiConfig: () => ({ config: {}, isLoaded: true, canUseApi: true, intentEnabled: true }),
}));
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReadingPage from '@/app/reading/page';
import type { IntentSnapshot } from '@/lib/intent/types';
import { mockReadingApi } from './helpers/reading-api';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('scene=preparation'),
}));
vi.mock('@/lib/api/stream-client', () => ({ streamInterpret: vi.fn() }));

function ready(question: string, clarify = false): IntentSnapshot {
  return {
    id: 'intent-preparation',
    version: 1,
    revision: 1,
    question,
    sceneId: 'preparation',
    messages: [{ id: 'message-1', text: question }],
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
      mode: clarify ? 'clarify' : 'reading',
      includeAction: true,
      reuseExistingCards: false,
      clarification: clarify ? '你想为哪件事做准备？' : null,
    },
  };
}

const analyze = vi.fn();

beforeEach(() => {
  analyze.mockReset();
  vi.stubGlobal('React', React);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  mockReadingApi();
  const readingFetch = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, options?: RequestInit) => {
      if (input === '/api/config')
        return Promise.resolve(Response.json({ available: true, intentEnabled: true }));
      if (input === '/api/intent')
        return analyze(JSON.parse(String(options?.body)), options?.signal);
      return readingFetch(input, options);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function enter(question: string) {
  fireEvent.change(screen.getByRole('textbox', { name: '写下你的问题' }), {
    target: { value: question },
  });
}
function submit() {
  fireEvent.click(screen.getByRole('button', { name: '使用此牌阵，开始洗牌' }));
}

describe('场景提问的意图识别门槛', () => {
  it('需要澄清时保留原问题，补充后重新识别才能进入洗牌', async () => {
    analyze.mockImplementationOnce(async ({ question }) => Response.json(ready(question, true)));
    analyze.mockImplementationOnce(async ({ question }) => Response.json(ready(question)));
    render(<ReadingPage />);
    enter('我想做些准备');
    submit();
    expect(await screen.findByText('你想为哪件事做准备？')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('我想做些准备');
    expect(screen.queryByRole('region', { name: '洗牌' })).not.toBeInTheDocument();
    enter('我想为明天的面试做准备');
    expect(screen.queryByText('你想为哪件事做准备？')).not.toBeInTheDocument();
    submit();
    expect(await screen.findByRole('region', { name: '洗牌' })).toBeInTheDocument();
    expect(analyze).toHaveBeenLastCalledWith(
      {
        question: '我想为明天的面试做准备',
        sceneId: 'preparation',
        previousIntentId: 'intent-preparation',
      },
      expect.any(AbortSignal),
    );
  });

  it('识别失败不前进且允许用户保留原问题重试', async () => {
    analyze.mockResolvedValueOnce(
      Response.json({ error: 'private server detail' }, { status: 503 }),
    );
    analyze.mockImplementationOnce(async ({ question }) => Response.json(ready(question)));
    render(<ReadingPage />);
    enter('明天面试怎么准备');
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('重试');
    expect(screen.getByRole('alert')).not.toHaveTextContent('private');
    expect(screen.getByRole('textbox')).toHaveValue('明天面试怎么准备');
    expect(screen.queryByRole('region', { name: '洗牌' })).not.toBeInTheDocument();
    submit();
    expect(await screen.findByRole('region', { name: '洗牌' })).toBeInTheDocument();
    expect(analyze).toHaveBeenCalledTimes(2);
  });

  it('识别等待期间重复点击只产生一个请求，成功后才进入洗牌', async () => {
    let resolve!: (response: Response) => void;
    analyze.mockReturnValue(
      new Promise<Response>((done) => {
        resolve = done;
      }),
    );
    render(<ReadingPage />);
    enter('明天面试怎么准备');
    submit();
    submit();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(screen.getByText('正在梳理你想讨论的问题…')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '洗牌' })).not.toBeInTheDocument();
    await act(async () => {
      resolve(Response.json(ready('明天面试怎么准备')));
    });
    expect(await screen.findByRole('region', { name: '洗牌' })).toBeInTheDocument();
  });

  it('等待期间编辑问题会取消旧识别，旧结果不得推进新问题', async () => {
    let resolve!: (response: Response) => void;
    analyze.mockReturnValueOnce(
      new Promise<Response>((done) => {
        resolve = done;
      }),
    );
    analyze.mockImplementationOnce(async ({ question }) => Response.json(ready(question)));
    render(<ReadingPage />);
    enter('面试准备');
    submit();
    const signal = analyze.mock.calls[0][1] as AbortSignal;
    enter('考试准备');
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolve(Response.json(ready('面试准备')));
    });
    expect(screen.getByRole('textbox')).toHaveValue('考试准备');
    expect(screen.queryByRole('region', { name: '洗牌' })).not.toBeInTheDocument();
    submit();
    expect(await screen.findByRole('region', { name: '洗牌' })).toBeInTheDocument();
    expect(analyze.mock.calls[1][0].question).toBe('考试准备');
  });
});
