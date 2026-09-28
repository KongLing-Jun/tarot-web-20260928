import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Interpretation } from '@/components/reading/Interpretation';

afterEach(cleanup);

describe('手机解读', () => {
  it('无行动章节的记录仍显示核心与可展开牌义，不产生空标题', () => {
    render(
      <Interpretation
        content={'## 核心解读\n本轮核心内容\n## 各牌说明\n本轮牌义'}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.getByText('本轮核心内容')).toBeVisible();
    expect(screen.queryByRole('heading', { name: '可以怎么做' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('牌义依据'));
    expect(screen.getByText('本轮牌义')).toBeVisible();
  });
  it('首字前停止也显示保留原牌重试提示', () => {
    render(
      <Interpretation
        content=""
        isLoading={false}
        error={null}
        notice="已停止生成，可保留原牌重试。"
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('已停止生成，可保留原牌重试。');
    expect(screen.queryByText('等 待 牌 面')).not.toBeInTheDocument();
  });
  it('中断后同时显示已收到正文和错误', () => {
    render(<Interpretation content="已经收到的重要建议" isLoading={false} error="已停止生成" />);
    expect(screen.getByText('已经收到的重要建议')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('已停止生成');
  });

  it('流式和完成阶段都折叠专业说明，正文及行动始终可见', () => {
    const content =
      '## 核心解读\n核心信息\n## 各牌说明\n完整牌面解释\n## 可采取的行动\n今天采取行动';
    const { rerender, container } = render(
      <Interpretation content={content} isLoading error={null} />,
    );
    expect(screen.queryByText('完整牌面解释')).not.toBeInTheDocument();
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    rerender(<Interpretation content={content} isLoading={false} error={null} />);
    expect(screen.getByText('核心信息')).toBeVisible();
    expect(screen.getByText('今天采取行动')).toBeVisible();
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('牌义依据'));
    expect(screen.getByText('完整牌面解释')).toBeVisible();
  });

  it('旧 Markdown 和不完整三段结构完整保留', () => {
    render(
      <Interpretation
        content={'旧版前言\n\n## 核心解读\n原始解释'}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.getByText('旧版前言')).toBeVisible();
    expect(screen.getByText('原始解释')).toBeVisible();
  });

  it('显示真实的选阵阶段', () => {
    render(<Interpretation content="" isLoading error={null} loadingLabel="正在选择牌阵" />);
    expect(screen.getByText('正在选择牌阵')).toBeVisible();
  });

  it('流式中两种详情独立控制，完成后隐藏思考并保留牌义展开', () => {
    const onDetailInteraction = vi.fn();
    const content =
      '<think>内部思考</think>## 核心解读\n事情\n## 可采取的行动\n步骤\n## 各牌说明\n牌义';
    const { rerender, container } = render(
      <Interpretation
        content={content}
        isLoading
        error={null}
        onDetailInteraction={onDetailInteraction}
      />,
    );
    expect(screen.queryByText('内部思考')).not.toBeInTheDocument();
    expect(screen.queryByText('牌义')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('牌义依据'));
    expect(onDetailInteraction).toHaveBeenCalledOnce();
    expect(screen.getByText('牌义')).toBeVisible();
    expect(screen.queryByText('内部思考')).not.toBeInTheDocument();
    rerender(
      <Interpretation
        content={content + '补充'}
        isLoading
        error={null}
        onDetailInteraction={onDetailInteraction}
      />,
    );
    expect(screen.getByText('牌义补充')).toBeVisible();
    fireEvent.click(screen.getByText('模型思考'));
    expect(screen.getByText('内部思考')).toBeVisible();
    expect(container.querySelectorAll('details')[1]).toHaveTextContent('模型思考');
    expect(onDetailInteraction).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByText('模型思考'));
    expect(onDetailInteraction).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByText('模型思考'));
    expect(screen.getByText('内部思考')).toBeVisible();
    rerender(
      <Interpretation
        content={content + '补充'}
        isLoading={false}
        error={null}
        onDetailInteraction={onDetailInteraction}
      />,
    );
    expect(screen.queryByText('模型思考')).not.toBeInTheDocument();
    expect(screen.queryByText('内部思考')).not.toBeInTheDocument();
    expect(screen.getByText('牌义补充')).toBeVisible();
  });

  it('新生成清空内容后折叠状态重置', () => {
    const content = '## 核心解读\n事情\n## 可采取的行动\n步骤\n## 各牌说明\n牌义';
    const { rerender } = render(
      <Interpretation content={content} isLoading={false} error={null} />,
    );
    fireEvent.click(screen.getByText('牌义依据'));
    expect(screen.getByText('牌义')).toBeVisible();
    rerender(<Interpretation content="" isLoading error={null} />);
    rerender(<Interpretation content={content} isLoading error={null} />);
    expect(screen.queryByText('牌义')).not.toBeInTheDocument();
  });
});
