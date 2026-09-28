import { getReadingById } from '@/lib/readingStorage';
import { apiFetch } from '@/lib/api/client';

export type ReadingCompletion = 'complete' | 'incomplete' | 'unknown';

/** 复用已有首轮聊天关联；旧记录或已清空的日志不能证明生成完整。 */
export async function getReadingForResume(id: string) {
  const reading = await getReadingById(id);
  if (!reading) throw new Error('未找到这条解读记录，它可能已被删除。');
  const exchangeId = (reading as typeof reading & { exchangeId?: string }).exchangeId;
  let completion: ReadingCompletion = 'unknown';
  if (exchangeId) {
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const page = await apiFetch<{
        messages: { exchangeId: string; role: string; status: string }[];
        hasMore: boolean;
      }>(`/api/messages?offset=${offset}`);
      const reply = page.messages.find(
        (message) => message.exchangeId === exchangeId && message.role === 'assistant',
      );
      if (reply) {
        completion = reply.status === 'done' ? 'complete' : 'incomplete';
        break;
      }
      offset += page.messages.length;
      hasMore = page.hasMore && page.messages.length > 0;
    }
  }
  return { reading, completion };
}
