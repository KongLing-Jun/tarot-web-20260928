import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { DraftAids, appendDraft } from '@/components/question/DraftAids';

afterEach(cleanup);

it('辅助内容只进入草稿，保留已有文字、去重且删除后不会自行恢复', () => {
  function Editor() {
    const [draft, setDraft] = useState('我的实际情况');
    return (
      <>
        <DraftAids onPick={(text) => setDraft((value) => appendDraft(value, text))} />
        <textarea
          aria-label="草稿"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </>
    );
  }
  render(<Editor />);
  fireEvent.click(screen.getByRole('button', { name: '发生了什么' }));
  fireEvent.click(screen.getByRole('button', { name: '发生了什么' }));
  expect(screen.getByRole('textbox')).toHaveValue('我的实际情况\n发生的事情是：');
  fireEvent.click(screen.getByRole('button', { name: '焦虑' }));
  expect(screen.getByRole('textbox')).toHaveValue('我的实际情况\n发生的事情是：\n我现在感到焦虑。');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '我其实很平静' } });
  expect(screen.getByRole('textbox')).toHaveValue('我其实很平静');
  fireEvent.click(screen.getByRole('button', { name: '不确定' }));
  expect(screen.getByRole('textbox')).toHaveValue('我其实很平静\n我还不确定自己的感受。');
});

it('空白输入可以直接使用示例，辅助文本不包含隐含经历', () => {
  expect(appendDraft('  ', '示例问题')).toBe('示例问题');
  expect(appendDraft('原文\n示例问题', '示例问题')).toBe('原文\n示例问题');
});
