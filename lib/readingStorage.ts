import type { Reading, FollowUp } from '@/lib/tarot/types';
import { apiFetch, ApiError } from '@/lib/api/client';
import type { GenerationStatus } from '@/lib/api/generation-result';

type StoredReading = Omit<Reading, 'createdAt'> & { createdAt: string };
const restore = (reading: StoredReading): Reading => ({
  ...reading,
  createdAt: new Date(reading.createdAt),
});

export async function saveReading(reading: Reading): Promise<void> {
  await apiFetch('/api/readings', { method: 'POST', body: JSON.stringify(reading) });
}

export async function getReadings(): Promise<Reading[]> {
  const readings: Reading[] = [];
  let hasMore = true;
  while (hasMore) {
    const page = await apiFetch<{ readings: StoredReading[]; hasMore: boolean }>(
      `/api/readings?offset=${readings.length}`,
    );
    readings.push(...page.readings.map(restore));
    hasMore = page.hasMore;
  }
  return readings;
}

export async function getReadingById(id: string): Promise<Reading | undefined> {
  try {
    await followUpWrites.get(id);
    const result = await apiFetch<{ reading: StoredReading }>(
      `/api/readings/${encodeURIComponent(id)}`,
    );
    return restore(result.reading);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return undefined;
    throw error;
  }
}

export async function deleteReadings(ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 500) {
    await apiFetch('/api/readings', {
      method: 'DELETE',
      body: JSON.stringify({ ids: ids.slice(i, i + 500) }),
    });
  }
}

export async function clearAll(): Promise<void> {
  await apiFetch('/api/readings', { method: 'DELETE', body: JSON.stringify({ all: true }) });
}

export async function updateReadingInterpretation(
  id: string,
  interpretation: string,
  generationStatus?: GenerationStatus,
): Promise<void> {
  await apiFetch(`/api/readings/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ interpretation, generationStatus }),
  });
}

const followUpWrites = new Map<string, Promise<void>>();
export async function updateReadingFollowUps(id: string, followUps: FollowUp[]): Promise<void> {
  const body = JSON.stringify({ followUps });
  const write = (followUpWrites.get(id) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      await apiFetch(`/api/readings/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body,
        keepalive: true,
      });
    });
  followUpWrites.set(id, write);
  try {
    await write;
  } finally {
    if (followUpWrites.get(id) === write) followUpWrites.delete(id);
  }
}
