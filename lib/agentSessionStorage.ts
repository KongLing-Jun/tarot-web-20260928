import { apiFetch } from '@/lib/api/client';
import type { Reading } from '@/lib/tarot/types';
import type { ReadingCompletion } from '@/lib/readingResume';

export interface AgentTask {
  id: string;
  question: string;
  readingId: string;
}

export interface RestoredAgentTask extends AgentTask {
  reading: Reading | null;
  completion: ReadingCompletion;
}

export async function loadAgentSession(): Promise<{
  tasks: RestoredAgentTask[];
  revision: number;
}> {
  const result = await apiFetch<{ tasks: RestoredAgentTask[]; revision: number }>(
    '/api/agent-session',
  );
  return {
    ...result,
    tasks: result.tasks.map((task) => ({
      ...task,
      reading: task.reading
        ? { ...task.reading, createdAt: new Date(task.reading.createdAt) }
        : null,
    })),
  };
}

export function saveAgentSession(tasks: AgentTask[], revision: number, signal?: AbortSignal) {
  return apiFetch<{ revision: number }>('/api/agent-session', {
    method: 'PUT',
    body: JSON.stringify({ tasks, revision }),
    signal,
  });
}
