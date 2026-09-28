import { beforeEach, expect, it, vi } from 'vitest';
import { getReadingForResume } from '@/lib/readingResume';
import { getReadingById } from '@/lib/readingStorage';
import { apiFetch } from '@/lib/api/client';
import { getSpreadById } from '@/lib/tarot/spreads';
import type { Reading } from '@/lib/tarot/types';

vi.mock('@/lib/readingStorage', () => ({ getReadingById: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
const reading: Reading & { exchangeId?: string } = {
  id: 'saved',
  question: '问题',
  spread: getSpreadById('single')!,
  drawnCards: [],
  createdAt: new Date(),
  interpretation: '已保存内容',
  exchangeId: 'exchange',
};
beforeEach(() => vi.resetAllMocks());

it.each(['pending', 'cancelled', 'error'])(
  '首轮聊天状态 %s 恢复为未完成，且只读取',
  async (status) => {
    vi.mocked(getReadingById).mockResolvedValue(reading);
    vi.mocked(apiFetch).mockResolvedValue({
      messages: [{ exchangeId: 'exchange', role: 'assistant', status }],
      hasMore: false,
    });
    expect(await getReadingForResume('saved')).toEqual({ reading, completion: 'incomplete' });
    expect(apiFetch).toHaveBeenCalledWith('/api/messages?offset=0');
  },
);

it('按页找到首轮完成状态，不误用用户消息或其他会话', async () => {
  vi.mocked(getReadingById).mockResolvedValue(reading);
  vi.mocked(apiFetch)
    .mockResolvedValueOnce({
      messages: [{ exchangeId: 'exchange', role: 'user', status: 'done' }],
      hasMore: true,
    })
    .mockResolvedValueOnce({
      messages: [{ exchangeId: 'exchange', role: 'assistant', status: 'done' }],
      hasMore: false,
    });
  expect((await getReadingForResume('saved')).completion).toBe('complete');
  expect(apiFetch).toHaveBeenLastCalledWith('/api/messages?offset=1');
});

it('日志被清空时状态未知，不把非空正文当作完成证据', async () => {
  vi.mocked(getReadingById).mockResolvedValue(reading);
  vi.mocked(apiFetch).mockResolvedValue({ messages: [], hasMore: false });
  expect((await getReadingForResume('saved')).completion).toBe('unknown');
});

it('没有聊天关联的旧记录保留原文与未知状态', async () => {
  vi.mocked(getReadingById).mockResolvedValue({ ...reading, exchangeId: undefined } as Reading);
  expect((await getReadingForResume('saved')).completion).toBe('unknown');
  expect(apiFetch).not.toHaveBeenCalled();
});

it('记录删除和读取失败不降级为新对话', async () => {
  vi.mocked(getReadingById)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('无权访问'));
  await expect(getReadingForResume('gone')).rejects.toThrow('未找到');
  await expect(getReadingForResume('private')).rejects.toThrow('无权访问');
});
