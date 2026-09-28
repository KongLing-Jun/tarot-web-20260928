import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReadingPage from '@/app/reading/page';
import { streamInterpret } from '@/lib/api/stream-client';
import { allCards } from '@/lib/tarot/cards';
import { readingScenes } from '@/lib/readingEntry';
import { getSpreadById } from '@/lib/tarot/spreads';
import type { Reading } from '@/lib/tarot/types';
import { getReadings } from '@/lib/readingStorage';
import { mockReadingApi } from './helpers/reading-api';

vi.mock('@/lib/api/stream-client', () => ({ streamInterpret: vi.fn() }));
vi.mock('@/hooks/useApiConfig', () => ({
  useApiConfig: () => ({ config: {}, isLoaded: true, canUseApi: true, intentEnabled: false }),
}));
const route = vi.hoisted(() => ({ query: '' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(route.query) }));

beforeEach(() => {
  route.query = '';
  const replaceState = window.history.replaceState.bind(window.history);
  vi.spyOn(window.history, 'replaceState').mockImplementation((data, unused, url) => {
    route.query = new URL(String(url), 'http://localhost').search.slice(1);
    replaceState(data, unused, url);
  });
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
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  vi.spyOn(Math, 'random').mockReturnValue(0.999999);
  mockReadingApi();
  const readingFetch = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, options?: RequestInit) => {
      if (input === '/api/config') return Promise.resolve(Response.json({ available: true }));
      return readingFetch(input, options);
    }),
  );
  vi.mocked(streamInterpret).mockResolvedValue({
    fullText: '先明确目标，再采取行动。',
    truncated: false,
    usingFallback: false,
    receivedError: false,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

function action(name: string | RegExp) {
  if (
    typeof name === 'string' &&
    ['全部揭牌', '返回调整', '重新抽牌'].includes(name) &&
    screen.queryByRole('button', { name: '揭牌更多操作' })
  ) {
    if (!screen.queryByRole('menu'))
      fireEvent.click(screen.getByRole('button', { name: '揭牌更多操作' }));
    return screen.getByRole('menuitem', { name });
  }
  if (
    typeof name === 'string' &&
    ['撤回上一张', '修改问题', '修改牌阵', '重新洗牌'].includes(name) &&
    screen.queryByRole('button', { name: '抽牌更多操作' })
  ) {
    if (!screen.queryByRole('menu'))
      fireEvent.click(screen.getByRole('button', { name: '抽牌更多操作' }));
    return screen.getByRole('menuitem', { name });
  }
  return screen.getByRole('button', { name });
}
function clickButton(name: string | RegExp) {
  fireEvent.click(action(name));
}

async function openDraw(spreadName = '单张牌') {
  render(<ReadingPage />);
  fireEvent.change(screen.getByRole('textbox', { name: '写下你的问题' }), {
    target: { value: '我可以如何行动？' },
  });
  clickButton(/下一步，选择牌阵/);
  if (!screen.queryByRole('button', { name: new RegExp(spreadName), pressed: true }))
    clickButton(new RegExp(spreadName));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: new RegExp(spreadName), pressed: true }),
    ).toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole('button', { name: new RegExp(spreadName), pressed: true }));
  await screen.findByRole('button', { name: '点击牌堆洗牌' });
  clickButton('点击牌堆洗牌');
  expect(screen.getByRole('button', { name: '开始抽牌' })).toBeDisabled();
  await waitFor(() => expect(screen.getByRole('button', { name: '开始抽牌' })).toBeEnabled(), {
    timeout: 3500,
  });
  expect(screen.queryByRole('button', { name: /牌堆第 1 张/ })).not.toBeInTheDocument();
  clickButton('开始抽牌');
  await act(async () => {});
  await screen.findByRole('button', { name: '牌堆第 4 张，未翻开' });
}

async function selectCard(deckPosition: number) {
  fireEvent.click(await screen.findByRole('button', { name: `牌堆第 ${deckPosition} 张，未翻开` }));
  fireEvent.click(screen.getByRole('button', { pressed: true }));
}

function interpretationRequest(index = 0) {
  return vi.mocked(streamInterpret).mock.calls[index][0] as Pick<
    Reading,
    'question' | 'drawnCards'
  >;
}

describe('手动占卜页面与状态整合', () => {
  it.each(['', 'spread=single'])('提问超限不能通过按钮或 Enter 继续，删减后恢复（%s）', (query) => {
    route.query = query;
    render(<ReadingPage />);
    const input = screen.getByRole('textbox', { name: '写下你的问题' });
    const next = screen.getByRole('button', {
      name: query ? '使用此牌阵，开始洗牌' : '下一步，选择牌阵',
    });
    const longDraft = '问'.repeat(501);
    fireEvent.change(input, { target: { value: longDraft } });
    expect(next).toBeDisabled();
    fireEvent.click(next);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue(longDraft);
    expect(screen.getByText('请精简到 500 字以内')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '问'.repeat(500) } });
    expect(next).toBeEnabled();
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(input).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.queryByRole('textbox', { name: '写下你的问题' })).not.toBeInTheDocument();
    expect(streamInterpret).not.toHaveBeenCalled();
  });

  it('目录预选牌阵后直接洗牌，不触发解读', async () => {
    route.query = 'spread=relationship';
    render(<ReadingPage />);
    expect(screen.getByText(/已选：关系牌阵/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '写下你的问题' }), {
      target: { value: '如何改善关系？' },
    });
    clickButton('使用此牌阵，开始洗牌');
    expect(await screen.findByRole('region', { name: '洗牌' })).toHaveTextContent('关系牌阵');
    expect(streamInterpret).not.toHaveBeenCalled();
  });

  it('目录更换牌阵后返回问题，保留草稿且不提前洗牌', async () => {
    route.query = 'spread=single';
    render(<ReadingPage />);
    fireEvent.change(screen.getByRole('textbox', { name: '写下你的问题' }), {
      target: { value: '下一步怎么做？' },
    });
    clickButton('更换牌阵');
    clickButton(/三张牌阵/);
    const selected = await screen.findByRole('button', { name: /三张牌阵/, pressed: true });
    fireEvent.click(selected);
    expect(await screen.findByRole('textbox', { name: '写下你的问题' })).toHaveValue(
      '下一步怎么做？',
    );
    expect(screen.getByText(/已选：三张牌阵/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '洗牌' })).not.toBeInTheDocument();
  });

  it('无效牌阵提示重新选择，保留普通提问流程', () => {
    route.query = 'spread=missing';
    render(<ReadingPage />);
    expect(screen.getByRole('status')).toHaveTextContent('未找到该牌阵');
    expect(screen.getByRole('button', { name: '下一步，选择牌阵' })).toBeInTheDocument();
  });
  it('未洗牌直接开始会先洗牌，完成后进入三张牌的抽牌流程', async () => {
    render(<ReadingPage />);
    fireEvent.change(screen.getByRole('textbox', { name: '写下你的问题' }), {
      target: { value: '我可以如何行动？' },
    });
    clickButton(/下一步，选择牌阵/);
    fireEvent.click(screen.getByRole('button', { pressed: true }));
    const start = await screen.findByRole('button', { name: '开始抽牌' });
    expect(start).toBeEnabled();
    fireEvent.click(start);
    expect(start).toBeDisabled();
    expect(screen.getByRole('button', { name: '点击牌堆洗牌' })).toBeDisabled();
    fireEvent.click(start);
    expect(screen.queryByRole('button', { name: '牌堆第 4 张，未翻开' })).not.toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: '牌堆第 4 张，未翻开' }, { timeout: 3500 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '洗牌' })).not.toBeInTheDocument();
  });

  it('择阵页从顶部返回保留问题，点击中央牌阵过渡后进入洗牌', async () => {
    render(<ReadingPage />);
    fireEvent.change(screen.getByRole('textbox', { name: '写下你的问题' }), {
      target: { value: '今天想探索什么？' },
    });
    clickButton(/下一步，选择牌阵/);
    expect(
      within(screen.getByRole('banner')).getByRole('button', { name: '返回问题' }),
    ).toBeInTheDocument();
    expect(within(screen.getByRole('banner')).getByRole('link', { name: '离开' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(screen.queryByRole('button', { name: /就.*此.*落.*阵/ })).not.toBeInTheDocument();
    clickButton('返回问题');
    expect(screen.getByRole('textbox', { name: '写下你的问题' })).toHaveValue('今天想探索什么？');
    clickButton(/下一步，选择牌阵/);
    fireEvent.click(screen.getByRole('button', { pressed: true }));
    expect(await screen.findByRole('region', { name: '洗牌' })).toBeInTheDocument();
  });

  it('单张从预选、确认到揭牌才可解读，重新解读保留同一张牌和历史', async () => {
    await openDraw();
    expect(screen.queryByRole('button', { name: '抽取这张' })).not.toBeInTheDocument();
    clickButton('牌堆第 1 张，未翻开');
    expect(screen.queryByRole('button', { name: '前往揭牌' })).not.toBeInTheDocument();
    expect(action('撤回上一张')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { pressed: true }));
    expect(screen.getByRole('heading', { name: /逐\s*张\s*揭\s*牌/ })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '半圆环牌堆' })).not.toBeInTheDocument();
    expect(action('返回调整')).toBeInTheDocument();
    const interpretationButton = screen.queryByRole('button', { name: /解读这些牌/ });
    if (interpretationButton) expect(interpretationButton).toBeDisabled();
    expect(streamInterpret).not.toHaveBeenCalled();
    clickButton('全部揭牌');
    expect(screen.queryByRole('button', { name: '返回调整' })).not.toBeInTheDocument();
    clickButton(/解读这些牌/);
    await waitFor(() => expect(screen.getByText('先明确目标，再采取行动。')).toBeInTheDocument());
    const cardsToggle = screen.getByText('· 收起牌面 ⌃').closest('summary')!;
    const cardsPanel = cardsToggle.closest('details')!;
    expect(cardsPanel).toHaveAttribute('open');
    fireEvent.click(cardsToggle);
    fireEvent(cardsPanel, new Event('toggle'));
    expect(cardsPanel).not.toHaveAttribute('open');
    const firstRequest = interpretationRequest();
    expect(firstRequest.question).toBe('我可以如何行动？');
    expect(firstRequest.drawnCards.map(({ card }) => card.id)).toEqual([allCards[0].id]);
    const firstHistory = (await getReadings())[0];
    clickButton(/重新解读（保留原牌）/);
    await waitFor(() => expect(streamInterpret).toHaveBeenCalledTimes(2));
    expect(cardsPanel).not.toHaveAttribute('open');
    fireEvent.click(cardsToggle);
    fireEvent(cardsPanel, new Event('toggle'));
    expect(cardsPanel).toHaveAttribute('open');
    expect(interpretationRequest(1).drawnCards).toEqual(firstRequest.drawnCards);
    const history = await getReadings();
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe(firstHistory.id);
  });

  it('三张牌自动进入揭牌，返回调整只撤回最后一张，替换后保持前两张并在首次揭牌后锁定', async () => {
    await openDraw('三张牌阵');
    await selectCard(1);
    await selectCard(2);
    await selectCard(3);
    clickButton('返回调整');
    expect(screen.getByRole('button', { name: '返回揭牌' })).toBeInTheDocument();
    clickButton('撤回上一张');
    expect(screen.getByText('已抽 2 / 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '牌堆第 1 张，已抽取' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '牌堆第 2 张，已抽取' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '牌堆第 3 张，未翻开' })).toBeEnabled();
    await selectCard(4);
    clickButton('过去，点击揭牌');
    expect(screen.queryByRole('button', { name: '返回调整' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /撤回/ })).not.toBeInTheDocument();
    clickButton('全部揭牌');
    clickButton(/解读这些牌/);
    await waitFor(() => expect(streamInterpret).toHaveBeenCalledTimes(1));
    expect(
      interpretationRequest().drawnCards.map(({ card, position }) => [position.nameCn, card.id]),
    ).toEqual([
      ['过去', allCards[0].id],
      ['现在', allCards[1].id],
      ['未来', allCards[3].id],
    ]);
  });

  it.each(['修改问题', '修改牌阵'])('%s 取消保留当前选择，确认后重新洗牌', async (editLabel) => {
    await openDraw();
    await selectCard(1);
    clickButton('返回调整');
    clickButton(editLabel);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /取 消/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(action('撤回上一张')).toBeEnabled();
    expect(screen.getByRole('button', { name: '牌堆第 1 张，已抽取' })).toBeDisabled();
    clickButton(editLabel);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /确认/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    if (editLabel === '修改问题') {
      expect(screen.getByRole('textbox', { name: '写下你的问题' })).toHaveValue('我可以如何行动？');
      fireEvent.change(screen.getByRole('textbox', { name: '写下你的问题' }), {
        target: { value: '下一步应关注什么？' },
      });
      clickButton(/下一步，选择牌阵/);
    }
    fireEvent.click(screen.getByRole('button', { pressed: true }));
    expect(await screen.findByRole('button', { name: '点击牌堆洗牌' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始抽牌' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /撤回/ })).not.toBeInTheDocument();
  });
});

const structuredReply =
  '## 核心解读\n先观察真实差异。\n\n## 可采取的行动\n1. 写下最在意的条件\n\n## 各牌说明\n保留原始牌义';
const completeReply = (fullText: string) => ({
  fullText,
  truncated: false,
  usingFallback: false,
  receivedError: false,
});
async function openReport() {
  vi.mocked(streamInterpret).mockResolvedValueOnce(completeReply(structuredReply));
  await openDraw();
  await selectCard(1);
  clickButton('全部揭牌');
  clickButton(/解读这些牌/);
  await screen.findByRole('tablist', { name: '解读章节' });
  await waitFor(() => expect(screen.getByRole('textbox', { name: '追问内容' })).toBeEnabled());
}

describe('手动模式复用提问与解读界面', () => {
  it('开头和感受只填草稿，下一步进入手动择阵而不调用解读', async () => {
    render(<ReadingPage />);
    expect(screen.getByRole('link', { name: '对话', current: 'page' })).toHaveAttribute(
      'href',
      '/agent',
    );
    clickButton('不知道怎么开头？');
    fireEvent.click(screen.getByRole('radio', { name: /从一个选择说起/ }));
    clickButton('填入输入框');
    expect(screen.getByRole('textbox', { name: '写下你的问题' })).toHaveValue(
      '我在……和……之间犹豫，最看重的是……，目前的限制是……',
    );
    clickButton(/添加此刻的感受/);
    fireEvent.click(screen.getByRole('checkbox', { name: '犹豫' }));
    clickButton('填入输入框');
    expect(screen.getByRole('textbox', { name: '写下你的问题' })).toHaveValue(
      '我在……和……之间犹豫，最看重的是……，目前的限制是……\n我此刻的感受：犹豫。',
    );
    expect(streamInterpret).not.toHaveBeenCalled();
    clickButton('下一步，选择牌阵');
    expect(await screen.findByRole('button', { pressed: true })).toBeEnabled();
    expect(streamInterpret).not.toHaveBeenCalled();
  });

  it('双卡与输入栏保留手动追问语义，草稿确认后才开启新问题', async () => {
    await openReport();
    expect(screen.getByRole('link', { name: '对话', current: 'page' })).toHaveAttribute(
      'href',
      '/agent',
    );
    fireEvent.click(screen.getByRole('tab', { name: /02/ }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('写下最在意的条件');
    expect(screen.queryByRole('button', { name: '✦ 辅助' })).not.toBeInTheDocument();
    const input = screen.getByRole('textbox', { name: '追问内容' });
    fireEvent.change(input, { target: { value: '我想补充一些情况：' } });
    expect(streamInterpret).toHaveBeenCalledTimes(1);
    clickButton('＋新问题');
    expect(screen.getByRole('dialog')).toHaveTextContent('未发送的草稿');
    clickButton('取 消');
    expect(input).toHaveValue('我想补充一些情况：');
    clickButton('＋新问题');
    clickButton('开始新问题');
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: '写下你的问题' })).toHaveValue(''),
    );
    expect((await getReadings()).length).toBe(1);
  });

  it('生成等待基于已抽牌，取消新问题保留请求，停止取消真实请求且可原牌重试', async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(streamInterpret).mockImplementationOnce((_request, _callbacks, options) => {
      signal = options?.signal;
      return new Promise((_resolve, reject) =>
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
      );
    });
    await openDraw();
    await selectCard(1);
    clickButton('全部揭牌');
    clickButton(/解读这些牌/);
    expect(await screen.findByRole('heading', { name: '正在生成解读' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('牌面已就绪，解读将在这里呈现。');
    expect(screen.queryByRole('list', { name: '生成阶段' })).not.toBeInTheDocument();
    expect(screen.queryByText('选择牌阵')).not.toBeInTheDocument();
    clickButton('＋新问题');
    clickButton('取 消');
    expect(signal?.aborted).toBe(false);
    clickButton('停 止');
    await waitFor(() => expect(signal?.aborted).toBe(true));
    expect(screen.queryByRole('region', { name: '解读生成状态' })).not.toBeInTheDocument();
    expect(screen.getByText(/已停止生成/)).toBeInTheDocument();
    const original = interpretationRequest().drawnCards;
    clickButton('重新解读（保留原牌）');
    await waitFor(() => expect(streamInterpret).toHaveBeenCalledTimes(2));
    expect(interpretationRequest(1).drawnCards).toEqual(original);
  });

  it('追问需要补牌时先揭牌再解读，不把待揭牌显示成正在生成', async () => {
    await openReport();
    vi.mocked(streamInterpret)
      .mockResolvedValueOnce(completeReply('{"decision":"draw","drawCount":2,"reason":"补充方向"}'))
      .mockResolvedValueOnce(completeReply('补牌后的实际回应'));
    fireEvent.change(screen.getByRole('textbox', { name: '追问内容' }), {
      target: { value: '还有什么可以留意？' },
    });
    clickButton('发送');
    expect(await screen.findByRole('button', { name: '全部揭牌' })).toBeInTheDocument();
    expect(streamInterpret).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('textbox', { name: '追问内容' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '停 止' })).not.toBeInTheDocument();
    clickButton('全部揭牌');
    expect(await screen.findByText('补牌后的实际回应')).toBeInTheDocument();
    expect(streamInterpret).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('textbox', { name: '追问内容' })).toBeEnabled();
  });

  it('追问判断失败后可重试并保留原牌', async () => {
    await openReport();
    vi.mocked(streamInterpret)
      .mockRejectedValueOnce(new Error('连接失败'))
      .mockResolvedValueOnce(
        completeReply('{"decision":"direct","drawCount":0,"reason":"承接补充"}'),
      )
      .mockResolvedValueOnce(completeReply('已根据补充重新理解'));
    fireEvent.change(screen.getByRole('textbox', { name: '追问内容' }), {
      target: { value: '其实我很平静' },
    });
    clickButton('发送');
    const followUp = await screen.findByRole('region', { name: '本次追问' });
    expect(await within(followUp).findByRole('alert')).toHaveTextContent(
      '发生未知错误，请稍后重试',
    );
    expect(vi.mocked(streamInterpret).mock.calls[1][0]).toMatchObject({
      followUp: { mode: 'decide' },
    });
    fireEvent.click(within(followUp).getByRole('button', { name: '重试补牌判断' }));
    expect(await screen.findByText('已根据补充重新理解')).toBeInTheDocument();
    expect(vi.mocked(streamInterpret).mock.calls[2][0]).toMatchObject({
      followUp: { mode: 'decide' },
    });
  });
});

describe('场景入口复用提问流程', () => {
  it.each(readingScenes)('$title 空白提问显示专属提示，填写后使用对应牌阵', async (scene) => {
    route.query = `scene=${scene.id}`;
    const view = render(<ReadingPage />);
    const input = screen.getByRole('textbox', { name: '写下你的问题' });
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('placeholder', scene.placeholder);
    expect(screen.getByRole('button', { name: '使用此牌阵，开始洗牌' })).toBeDisabled();
    expect(screen.queryByText('0 / 500')).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: '我补充后的真实问题' } });
    route.query += '&from=home';
    view.rerender(<ReadingPage />);
    expect(input).toHaveValue('我补充后的真实问题');
    expect(streamInterpret).not.toHaveBeenCalled();
    expect(
      vi.mocked(fetch).mock.calls.every(([url]) => !String(url).includes('/api/readings')),
    ).toBe(true);
    clickButton('使用此牌阵，开始洗牌');
    expect(await screen.findByRole('region', { name: '洗牌' })).toHaveTextContent(
      '我补充后的真实问题',
    );
    expect(screen.getByRole('region', { name: '洗牌' })).toHaveTextContent(
      getSpreadById(scene.spreadId)!.nameCn,
    );
  });

  it.each(readingScenes)('$title 的开头仅由主动选择填入，追加保留原稿且不重复', async (scene) => {
    route.query = `scene=${scene.id}`;
    render(<ReadingPage />);
    const input = screen.getByRole('textbox', { name: '写下你的问题' });
    let draft = '';
    for (const opening of scene.openings) {
      clickButton('不知道怎么开头？');
      const dialog = screen.getByRole('dialog', { name: '帮你开个头' });
      expect(within(dialog).getAllByRole('radio')).toHaveLength(3);
      expect(within(dialog).queryByText('从一件事说起')).not.toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: '填入输入框' })).toBeDisabled();
      fireEvent.click(within(dialog).getByRole('radio', { name: new RegExp(opening.title) }));
      expect(input).toHaveValue(draft);
      fireEvent.click(within(dialog).getByRole('button', { name: '填入输入框' }));
      draft = draft ? `${draft}\n${opening.text}` : opening.text;
      expect(input).toHaveValue(draft);
      expect(input).toHaveFocus();
    }
    clickButton('不知道怎么开头？');
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(scene.openings[0].title) }));
    clickButton('填入输入框');
    expect(input).toHaveValue(draft);
    expect(streamInterpret).not.toHaveBeenCalled();
    await act(async () => {});
  });

  it.each(['preparation', 'stuck'])(
    '%s 追加场景开头超限时保留全文，精简后恢复，清空后重新显示场景提示',
    async (id) => {
      route.query = `scene=${id}`;
      render(<ReadingPage />);
      const scene = readingScenes.find((scene) => scene.id === id)!;
      const input = screen.getByRole('textbox', { name: '写下你的问题' });
      fireEvent.change(input, { target: { value: '问'.repeat(500) } });
      clickButton('不知道怎么开头？');
      fireEvent.click(screen.getByRole('radio', { name: new RegExp(scene.openings[0].title) }));
      clickButton('填入输入框');
      expect(input).toHaveValue(`${'问'.repeat(500)}\n${scene.openings[0].text}`);
      expect(screen.getByText('请精简到 500 字以内')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '使用此牌阵，开始洗牌' })).toBeDisabled();
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(input).toBeInTheDocument();
      fireEvent.change(input, { target: { value: '我明天需要做一次汇报，如何准备？' } });
      expect(screen.getByRole('button', { name: '使用此牌阵，开始洗牌' })).toBeEnabled();
      fireEvent.change(input, { target: { value: '' } });
      expect(input).toHaveAttribute('placeholder', scene.placeholder);
      expect(screen.queryByText('0 / 500')).not.toBeInTheDocument();
      await act(async () => {});
    },
  );

  it('改为自选清除场景 URL，选阵和返回问题都保留编辑；新外部场景重新初始化', async () => {
    route.query = 'scene=relationship';
    const view = render(<ReadingPage />);
    fireEvent.change(screen.getByRole('textbox', { name: '写下你的问题' }), {
      target: { value: '保留这段编辑' },
    });
    clickButton('改为自选牌阵');
    expect(route.query).toBe('');
    expect(screen.getByRole('button', { pressed: true })).toHaveAttribute(
      'data-spread-id',
      'three-card',
    );
    expect(screen.queryByRole('button', { name: /关系牌阵/ })).not.toBeInTheDocument();
    clickButton('使用此牌阵，返回问题');
    expect(await screen.findByRole('textbox', { name: '写下你的问题' })).toHaveValue(
      '保留这段编辑',
    );
    expect(screen.queryByText('场景占卜 · 关系走向')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '写下你的问题' })).toHaveAttribute(
      'placeholder',
      expect.stringContaining('时间或资源限制'),
    );
    clickButton('不知道怎么开头？');
    expect(screen.getByText('从一件事说起')).toBeInTheDocument();
    expect(screen.queryByText('最近相处有了变化')).not.toBeInTheDocument();
    clickButton('关闭弹窗');
    route.query = 'scene=two-options';
    view.rerender(<ReadingPage />);
    expect(screen.getByRole('textbox', { name: '写下你的问题' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: '写下你的问题' })).toHaveAttribute(
      'placeholder',
      readingScenes[1].placeholder,
    );
  });

  it('场景洗牌页修改牌阵回到四种通用选择，保留问题', async () => {
    route.query = 'scene=two-options';
    render(<ReadingPage />);
    fireEvent.change(screen.getByRole('textbox', { name: '写下你的问题' }), {
      target: { value: '比较两个选择的真实问题' },
    });
    clickButton('使用此牌阵，开始洗牌');
    clickButton('修改牌阵');
    expect(await screen.findByRole('region', { name: '选择牌阵' })).toBeInTheDocument();
    clickButton('返回问题');
    expect(screen.getByRole('textbox', { name: '写下你的问题' })).toHaveValue(
      '比较两个选择的真实问题',
    );
    expect(screen.getByRole('button', { name: '下一步，选择牌阵' })).toBeInTheDocument();
  });

  it.each(['preparation', 'stuck'])('%s 完成解读后，新问题保持场景与牌阵但清空草稿', async (id) => {
    const scene = readingScenes.find((scene) => scene.id === id)!;
    const spread = getSpreadById(scene.spreadId)!;
    route.query = `scene=${id}`;
    render(<ReadingPage />);
    fireEvent.change(screen.getByRole('textbox', { name: '写下你的问题' }), {
      target: { value: '明天汇报前我值得留意什么？' },
    });
    clickButton('使用此牌阵，开始洗牌');
    clickButton('开始抽牌');
    await screen.findByRole('button', { name: '牌堆第 4 张，未翻开' }, { timeout: 3500 });
    for (let index = 1; index <= spread.positions.length; index++) await selectCard(index);
    clickButton('全部揭牌');
    clickButton(/解读这些牌/);
    await screen.findByText('先明确目标，再采取行动。');
    expect(interpretationRequest().drawnCards).toHaveLength(spread.positions.length);
    clickButton('＋新问题');
    const input = await screen.findByRole('textbox', { name: '写下你的问题' });
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('placeholder', scene.placeholder);
    expect(screen.getByText(`场景占卜 · ${scene.title}`)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`已选：${spread.nameCn}`))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '使用此牌阵，开始洗牌' })).toBeDisabled();
  });
});
