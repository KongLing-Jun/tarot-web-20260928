// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PUT } from '@/app/api/product-tour/route';
import { hashToken, requireUser } from '@/lib/server/auth';
import { checkOrigin, HttpError } from '@/lib/server/http';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/server/database', () => ({ database: () => ({ query }) }));
vi.mock('@/lib/server/auth', async (original) => ({
  ...(await original<typeof import('@/lib/server/auth')>()),
  requireUser: vi.fn(),
}));
const accountScope = hashToken('product-tour:account-a');
const body = { version: 1, accountScope, status: 'skipped' };
const request = (data?: unknown, headers?: Record<string, string>) =>
  new NextRequest('http://localhost/api/product-tour', {
    method: data === undefined ? 'GET' : 'PUT',
    headers,
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  query.mockResolvedValue({ rows: [{ status: null }] });
  vi.mocked(requireUser).mockImplementation(async (req) => {
    if (req.method !== 'GET') checkOrigin(req);
    return { id: 'account-a' } as Awaited<ReturnType<typeof requireUser>>;
  });
});

it('returns unseen only after a successful account-scoped read, without private identity', async () => {
  const response = await GET(request());
  expect(await response.json()).toEqual({ version: 1, accountScope, status: null });
  expect(query.mock.calls[0][1]).toEqual(['account-a', 1]);
  expect(response.headers.get('cache-control')).toBe('no-store');
});

it.each(['completed', 'skipped'])('returns persisted %s', async (status) => {
  query.mockResolvedValue({ rows: [{ status }] });
  expect(await (await GET(request())).json()).toMatchObject({ status });
});

it.each([
  {},
  { ...body, version: 2 },
  { ...body, status: 'started' },
  { ...body, accountScope: null },
  { ...body, userId: 'other' },
])('rejects invalid writes before touching storage: %j', async (data) => {
  expect((await PUT(request(data))).status).toBe(400);
  expect(query).not.toHaveBeenCalled();
});

it('rejects malformed JSON and a stale account binding', async () => {
  expect(
    (await PUT(new NextRequest('http://localhost/api/product-tour', { method: 'PUT', body: '{' })))
      .status,
  ).toBe(400);
  expect(
    (await PUT(request({ ...body, accountScope: hashToken('product-tour:account-b') }))).status,
  ).toBe(409);
  expect(query).not.toHaveBeenCalled();
});

it('uses session ownership and returns the effective status after a monotonic update', async () => {
  query
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ status: 'completed' }] });
  const response = await PUT(request(body));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: 'completed', accountScope });
  expect(query.mock.calls[0][1]).toEqual(['account-a', 1, 'skipped']);
  expect(query.mock.calls[1][1]).toEqual(['account-a', 1]);
  expect(response.headers.get('cache-control')).toBe('no-store');
});

it('does not treat a missing authenticated user row as unseen', async () => {
  query.mockResolvedValue({ rows: [] });
  expect((await GET(request())).status).toBe(401);
  expect((await PUT(request(body))).status).toBe(401);
});

it('enforces authentication and same-origin writes', async () => {
  expect((await PUT(request(body, { origin: 'https://other.example' }))).status).toBe(403);
  vi.mocked(requireUser).mockRejectedValue(new HttpError(401, '请登录'));
  expect((await GET(request())).status).toBe(401);
  expect((await PUT(request(body))).status).toBe(401);
  expect(query).not.toHaveBeenCalled();
});

it('does not convert database failure into an unseen record', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  query.mockRejectedValue(new Error('private database details'));
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: '服务暂不可用，请稍后重试' });
  log.mockRestore();
});
