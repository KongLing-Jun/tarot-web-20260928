import { parseReadingContent } from './interpretation';

export interface ChatHistoryMessage {
  id: string;
  exchangeId?: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'pending' | 'done' | 'error' | 'cancelled';
  generationStatus?: string | null;
  createdAt: string;
}
export interface ChatHistoryExchange {
  id: string;
  createdAt: string;
  messages: ChatHistoryMessage[];
}
export type ChatHistoryPage = { messages: ChatHistoryMessage[]; hasMore: boolean };

export function groupChatExchanges(messages: ChatHistoryMessage[]): ChatHistoryExchange[] {
  const groups = new Map<string, ChatHistoryExchange>();
  const seen = new Set<string>();
  for (const message of messages) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    // Never guess a question/reply pairing from adjacency or matching timestamps.
    const id = message.exchangeId ? `exchange:${message.exchangeId}` : `message:${message.id}`;
    const group = groups.get(id) ?? { id, createdAt: message.createdAt, messages: [] };
    group.messages.push(message);
    if (Date.parse(message.createdAt) > Date.parse(group.createdAt))
      group.createdAt = message.createdAt;
    groups.set(id, group);
  }
  return [...groups.values()]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .map((group) => ({
      ...group,
      messages: group.messages.sort((a, b) =>
        a.role !== b.role
          ? a.role === 'user'
            ? -1
            : 1
          : Date.parse(a.createdAt) - Date.parse(b.createdAt),
      ),
    }));
}

export function messagePreview(content: string): string {
  const { answer } = parseReadingContent(content, false);
  return answer
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*|__/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function messageStatus(message: ChatHistoryMessage): string | undefined {
  if (message.generationStatus === 'truncated') return '回复被截断';
  if (message.generationStatus === 'interrupted') return '生成未完成';
  if (message.generationStatus === 'no-valid-answer') return '尚无有效回复';
  if (message.status === 'pending') return '生成中或连接已中断';
  if (message.status === 'error') return '生成未完成';
  if (message.status === 'cancelled') return '已停止';
  return undefined;
}
