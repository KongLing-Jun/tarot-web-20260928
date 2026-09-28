// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/readings/route';
import { PATCH } from '@/app/api/readings/[id]/route';
import { loadIntentForReading } from '@/lib/server/intent';
import { database } from '@/lib/server/database';
import { requireUser } from '@/lib/server/auth';
import { HttpError } from '@/lib/server/http';
import { spreads } from '@/lib/tarot/spreads';
import type { IntentSnapshot } from '@/lib/intent/types';

vi.mock('@/lib/server/intent', () => ({ loadIntentForReading: vi.fn() }));
vi.mock('@/lib/server/database', () => ({ database: vi.fn() }));
vi.mock('@/lib/server/auth', () => ({ requireUser: vi.fn() }));

const query = vi.fn();
const initialIntentId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const followUpIntentId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const readingId = 'owned-reading';
const question = '明天面试怎么准备';
const followUp = {
  id: 'follow-up-1',
  question: '不是换工作，只想准备自我介绍',
  status: 'done',
  decision: 'direct',
  additionalCards: [],
  interpretation: '已经完成的解读',
  error: null,
};
const reading = {
  id: readingId,
  question,
  spread: spreads[0],
  drawnCards: [],
  createdAt: '2026-09-23T00:00:00.000Z',
  interpretation: '',
  followUps: [],
};
function request(method: string, body: object) {
  return new NextRequest('http://localhost/api/readings', { method, body: JSON.stringify(body) });
}
const context = () => ({ params: Promise.resolve({ id: readingId }) });

beforeEach(() => {
  vi.clearAllMocks();
  query.mockResolvedValue({ rows: [], rowCount: 1 });
  vi.mocked(database).mockReturnValue({ query } as unknown as ReturnType<typeof database>);
  vi.mocked(requireUser).mockResolvedValue({ id: 'user-a' } as Awaited<
    ReturnType<typeof requireUser>
  >);
  vi.mocked(loadIntentForReading).mockResolvedValue({ id: initialIntentId } as IntentSnapshot);
});

describe('reading intent references', () => {
  it('validates an initial snapshot before saving without querying a not-yet-created reading', async () => {
    const response = await POST(
      request('POST', { ...reading, intentId: initialIntentId, sceneId: 'preparation' }),
    );
    expect(response.status).toBe(200);
    expect(loadIntentForReading).toHaveBeenCalledWith('user-a', initialIntentId, question, {
      sceneId: 'preparation',
    });
    expect(vi.mocked(loadIntentForReading).mock.calls[0][3]).not.toHaveProperty('readingId');
    const saved = JSON.parse(query.mock.calls[0][1][2]);
    expect(saved).toMatchObject({
      id: readingId,
      intentId: initialIntentId,
      sceneId: 'preparation',
    });
    expect(vi.mocked(loadIntentForReading).mock.invocationCallOrder[0]).toBeLessThan(
      query.mock.invocationCallOrder[0],
    );
  });

  it('allows retrying the same initial save with the same id and snapshot', async () => {
    const body = { ...reading, intentId: initialIntentId };
    expect((await POST(request('POST', body))).status).toBe(200);
    expect((await POST(request('POST', body))).status).toBe(200);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]).toEqual(query.mock.calls[1]);
    expect(query.mock.calls[0][0]).toContain('ON CONFLICT (user_id, id)');
  });

  it('validates follow-up references against the actual reading id on POST', async () => {
    const response = await POST(
      request('POST', {
        ...reading,
        sceneId: 'preparation',
        followUps: [{ ...followUp, intentId: followUpIntentId }],
      }),
    );
    expect(response.status).toBe(200);
    expect(loadIntentForReading).toHaveBeenCalledWith(
      'user-a',
      followUpIntentId,
      followUp.question,
      { readingId, sceneId: 'preparation' },
    );
    expect(JSON.parse(query.mock.calls[0][1][2]).followUps[0].intentId).toBe(followUpIntentId);
  });

  it('validates follow-up references against the path reading id on PATCH', async () => {
    const response = await PATCH(
      request('PATCH', { followUps: [{ ...followUp, intentId: followUpIntentId }] }),
      context(),
    );
    expect(response.status).toBe(200);
    expect(loadIntentForReading).toHaveBeenCalledWith(
      'user-a',
      followUpIntentId,
      followUp.question,
      { readingId },
    );
    expect(query.mock.calls[0][1].slice(0, 2)).toEqual(['user-a', readingId]);
    expect(JSON.parse(query.mock.calls[0][1][2]).followUps[0].intentId).toBe(followUpIntentId);
  });

  it.each([404, 409])(
    'blocks a foreign or stale initial snapshot before SQL, status %s',
    async (status) => {
      vi.mocked(loadIntentForReading).mockRejectedValueOnce(new HttpError(status, '意图不可用'));
      const response = await POST(request('POST', { ...reading, intentId: initialIntentId }));
      expect(response.status).toBe(status);
      expect(query).not.toHaveBeenCalled();
    },
  );

  it.each(['POST', 'PATCH'])(
    'blocks foreign or stale follow-up references before %s persistence',
    async (method) => {
      for (const status of [404, 409]) {
        vi.mocked(loadIntentForReading).mockRejectedValueOnce(new HttpError(status, '意图不可用'));
        const body = { ...reading, followUps: [{ ...followUp, intentId: followUpIntentId }] };
        const response =
          method === 'POST'
            ? await POST(request(method, body))
            : await PATCH(request(method, body), context());
        expect(response.status).toBe(status);
        expect(query).not.toHaveBeenCalled();
      }
    },
  );

  it('does not load intent snapshots for legacy POST or PATCH without references', async () => {
    expect((await POST(request('POST', reading))).status).toBe(200);
    expect((await PATCH(request('PATCH', { followUps: [followUp] }), context())).status).toBe(200);
    expect(loadIntentForReading).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(2);
  });
});
