import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadingReport } from '@/components/reading/ReadingReport';

beforeEach(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  ),
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const core = '从实际经历出发，观察关系中的沟通。'.repeat(16);
const content = `## 核心解读\n${core}\n\n## 可采取的行动\n1. 表达自己的感受\n2. 观察对方回应\n\n## 各牌说明\n原始牌义内容`;
const props = {
  content,
  running: false,
  error: null,
  hasCards: true,
  cardTerms: [],
  positionTerms: [],
  onDetailInteraction: vi.fn(),
};

describe('双卡报告', () => {
  it.each(['', '\n## 各牌说明\n原始牌义内容'])(
    '没有行动时仅显示核心正文且不显示空分页：%s',
    (suffix) => {
      render(<ReadingReport {...props} content={`## 核心解读\n核心内容${suffix}`} />);
      expect(screen.getByText('核心内容')).toBeVisible();
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
      expect(screen.queryByText(/两个视角/)).not.toBeInTheDocument();
      expect(screen.queryByText('01 / 02')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '可以怎么做 →' })).not.toBeInTheDocument();
      expect(screen.queryByText(/这一部分尚未生成/)).not.toBeInTheDocument();
      if (suffix) expect(screen.getByText('原始牌义内容').closest('details')).toBeInTheDocument();
    },
  );

  it('流式行动正文到达后才出现第二视角，空标题不产生空卡', () => {
    const initial = '## 核心解读\n核心内容';
    const { rerender } = render(<ReadingReport {...props} content={initial} running />);
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    rerender(<ReadingReport {...props} content={`${initial}\n## 可采取的行动\n`} running />);
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    rerender(
      <ReadingReport
        {...props}
        content={`${initial}\n## 可采取的行动\n先确认你的限制。`}
        running
      />,
    );
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    fireEvent.click(screen.getByRole('tab', { name: /02/ }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('先确认你的限制。');
  });

  it('空核心章节不会遮住实际行动，也不显示双视角', () => {
    render(<ReadingReport {...props} content={'## 核心解读\n\n## 可采取的行动\n实际行动'} />);
    expect(screen.getByText('实际行动')).toBeVisible();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByText(/这一部分尚未生成/)).not.toBeInTheDocument();
  });

  it('单章中断保留正文与错误，横滑不会切到空行动', () => {
    render(<ReadingReport {...props} content={'## 核心解读\n已收到的内容'} error="回复传输中断" />);
    const section = screen.getByRole('region', { name: '事情怎么看' });
    fireEvent.touchStart(section, { touches: [{ clientX: 200, clientY: 100 }] });
    fireEvent.touchEnd(section, { changedTouches: [{ clientX: 50, clientY: 105 }] });
    expect(screen.getByText('已收到的内容')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('回复传输中断');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });
  it('等待卡按真实牌面更新文案，不显示三段步骤，正文到达才切换为报告', () => {
    const { rerender } = render(<ReadingReport {...props} content="" running hasCards={false} />);
    expect(screen.getByRole('heading', { name: '正在选择牌阵' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '生成阶段' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('正在为你的问题选择牌阵');
    rerender(<ReadingReport {...props} content="<think>实际返回的信息</think>" running />);
    expect(screen.getByRole('heading', { name: '正在生成解读' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('牌面已就绪，解读将在这里呈现。');
    expect(screen.queryByText('问题已记录', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('查看生成信息'));
    expect(screen.getByText('实际返回的信息')).toBeVisible();
    rerender(<ReadingReport {...props} content="## 核心解读" running />);
    expect(screen.getByRole('region', { name: '解读生成状态' })).toBeInTheDocument();
    rerender(<ReadingReport {...props} running />);
    expect(screen.queryByRole('region', { name: '解读生成状态' })).not.toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveTextContent(core);
  });

  it('重试使用真实次数，停止或错误立即退出等待动效', () => {
    const { rerender } = render(
      <ReadingReport {...props} content="" running retry={{ attempt: 2, max: 3 }} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('第 2 / 3 次');
    expect(screen.getByRole('heading', { name: '正在重新连接' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '解读生成状态' })).toHaveAttribute(
      'data-retrying',
      'true',
    );
    rerender(<ReadingReport {...props} content="" running error="连接失败" />);
    expect(screen.queryByRole('region', { name: '解读生成状态' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('连接失败');
    rerender(<ReadingReport {...props} content="" error="已停止生成" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('已停止生成');
  });

  it('根据实际换行高度显示展开入口，短文本溢出也能完整阅读', () => {
    let measure = () => {};
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          measure = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    render(
      <ReadingReport
        {...props}
        content={
          '## 核心解读\n少量文字也可能在窄屏换行。\n\n## 可采取的行动\n先观察\n\n## 各牌说明\n说明'
        }
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '收起本段 ⌃' }));
    const body = screen.getByRole('tabpanel').querySelector('[id*="-text-"]')!;
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 140 });
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 180 });
    act(() => measure());
    fireEvent.click(screen.getByRole('button', { name: '展开本段 ⌄' }));
    expect(screen.getByRole('button', { name: '收起本段 ⌃' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
  it('两种视角默认展开完整原文，手动收起后切换仍记住状态', () => {
    render(<ReadingReport {...props} />);
    expect(screen.getByRole('tabpanel')).toHaveTextContent(core);
    expect(screen.getByRole('tabpanel')).not.toHaveTextContent('表达自己的感受');
    expect(screen.getByRole('button', { name: '收起本段 ⌃' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('tabpanel').querySelector('[id*="-text-"]')?.className).not.toContain(
      'excerpt',
    );
    fireEvent.click(screen.getByRole('button', { name: '收起本段 ⌃' }));
    fireEvent.click(screen.getByRole('tab', { name: /02/ }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('表达自己的感受');
    expect(screen.getByRole('tabpanel')).not.toHaveTextContent(core);
    expect(screen.getByRole('button', { name: '收起本段 ⌃' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: '← 事情怎么看' }));
    expect(screen.getByRole('button', { name: '展开本段 ⌄' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    fireEvent.click(screen.getByRole('button', { name: '展开本段 ⌄' }));
    expect(screen.getByRole('button', { name: '收起本段 ⌃' })).toBeInTheDocument();
    expect(screen.getByText('原始牌义内容').closest('details')).not.toHaveAttribute('open');
  });

  it('支持键盘切换和横向滑动，纵向滚动不切换章节', () => {
    render(<ReadingReport {...props} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: /01/ }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /02/ })).toHaveFocus();
    fireEvent.touchStart(screen.getByRole('tabpanel'), {
      touches: [{ clientX: 200, clientY: 100 }],
    });
    fireEvent.touchEnd(screen.getByRole('tabpanel'), {
      changedTouches: [{ clientX: 300, clientY: 300 }],
    });
    expect(screen.getByRole('tab', { name: /02/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.touchStart(screen.getByRole('tabpanel'), {
      touches: [{ clientX: 100, clientY: 100 }],
    });
    fireEvent.touchEnd(screen.getByRole('tabpanel'), {
      changedTouches: [{ clientX: 230, clientY: 105 }],
    });
    expect(screen.getByRole('tab', { name: /01/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('没有正文时明确显示错误和原牌保留提示，不展示空章节', () => {
    render(<ReadingReport {...props} content="" error="请求过于频繁，请稍后再试" />);
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('本次牌面已保留，不需要重新抽牌');
    expect(screen.getByRole('alert')).toHaveTextContent('请求过于频繁');
  });

  it('部分失败保留原文，重新生成重置章节但追加流式内容不抢回已选视角', () => {
    const { rerender } = render(<ReadingReport {...props} error="连接中断" />);
    expect(screen.getByRole('tabpanel')).toHaveTextContent(core);
    expect(screen.getByRole('alert')).toHaveTextContent('已保留生成的内容');
    fireEvent.click(screen.getByRole('button', { name: '收起本段 ⌃' }));
    fireEvent.click(screen.getByRole('tab', { name: /02/ }));
    fireEvent.click(screen.getByRole('button', { name: '收起本段 ⌃' }));
    rerender(<ReadingReport {...props} running />);
    expect(screen.getByRole('tab', { name: /01/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: '收起本段 ⌃' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    fireEvent.click(screen.getByRole('tab', { name: /02/ }));
    expect(screen.getByRole('button', { name: '收起本段 ⌃' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: '收起本段 ⌃' }));
    rerender(<ReadingReport {...props} running content={content + '\n新的牌义说明'} />);
    expect(screen.getByRole('tab', { name: /02/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel').querySelector('[id*="-text-"]')?.className).toContain(
      'excerpt',
    );
  });

  it('旧版无结构报告照常显示，不丢失正文', () => {
    render(<ReadingReport {...props} content="旧版完整报告" />);
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('heading', { name: '本次解读' }).parentElement!).getByText(
        '旧版完整报告',
      ),
    ).toBeInTheDocument();
  });
});
