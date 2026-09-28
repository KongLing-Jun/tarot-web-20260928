// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { checkOrigin } from '@/lib/server/http';
import { PATCH } from '@/app/api/auth/me/route';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/server/database', () => ({ database: () => ({ query }) }));

describe('request origin validation', () => {
  it.each([
    ['http://0.0.0.0:3001', 'localhost:3001', 'http://localhost:3001'],
    ['http://0.0.0.0:3001', '192.168.1.20:3001', 'http://192.168.1.20:3001'],
    ['http://0.0.0.0:3001', '[::1]:3001', 'http://[::1]:3001'],
    ['https://127.0.0.1:3001', 'tarot.example.com', 'https://tarot.example.com'],
    ['https://127.0.0.1:3001', 'tarot.example.com:8443', 'https://tarot.example.com:8443'],
    ['http://localhost:3001', '', 'http://localhost:3001'],
  ])('accepts the public origin %s / %s / %s', (url, host, origin) => {
    const request = new Request(`${url}/api/auth/me`, {
      headers: { origin, ...(host ? { host } : {}), 'sec-fetch-site': 'same-origin' },
    });
    expect(() => checkOrigin(request)).not.toThrow();
  });

  it.each([
    'https://other.example',
    'http://localhost:3002',
    'https://localhost:3001',
    'http://0.0.0.0:3001',
    'http://localhost:3001.evil.example',
    'null',
  ])('rejects a different or opaque origin: %s', (origin) => {
    const request = new Request('http://0.0.0.0:3001/api/auth/me', {
      headers: { host: 'localhost:3001', origin, 'x-forwarded-host': 'other.example' },
    });
    expect(() => checkOrigin(request)).toThrow('请求来源无效');
  });

  it('rejects cross-site metadata even with a matching or missing Origin', () => {
    for (const origin of ['http://localhost:3001', '']) {
      const request = new Request('http://localhost:3001/api/auth/me', {
        headers: { ...(origin ? { origin } : {}), 'sec-fetch-site': 'cross-site' },
      });
      expect(() => checkOrigin(request)).toThrow('请求来源无效');
    }
  });

  it('keeps supporting clients without Origin or fetch metadata', () => {
    expect(() => checkOrigin(new Request('http://localhost:3001/api/auth/me'))).not.toThrow();
  });

  it('saves a profile through real authentication when Next.js uses a wildcard bind address', async () => {
    const user = {
      id: 'test-user',
      nickname: '星旅人',
      avatarUrl: '/avatars/default.svg',
      createdAt: '2026-09-10',
    };
    query.mockReset();
    query.mockResolvedValueOnce({ rows: [user] });
    query.mockResolvedValueOnce({ rows: [{ ...user, nickname: '星旅人22' }] });
    const response = await PATCH(
      new NextRequest('http://0.0.0.0:3001/api/auth/me', {
        method: 'PATCH',
        headers: {
          host: 'localhost:3001',
          origin: 'http://localhost:3001',
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          cookie: `tarot_session=${'a'.repeat(64)}`,
        },
        body: JSON.stringify({ nickname: '星旅人22' }),
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).user.nickname).toBe('星旅人22');
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][1]).toEqual(['test-user', '星旅人22']);
  });

  it('rejects a cross-origin profile write before accessing the database', async () => {
    query.mockReset();
    const response = await PATCH(
      new NextRequest('http://0.0.0.0:3001/api/auth/me', {
        method: 'PATCH',
        headers: {
          host: 'localhost:3001',
          origin: 'https://other.example',
          cookie: `tarot_session=${'a'.repeat(64)}`,
        },
        body: JSON.stringify({ nickname: '星旅人22' }),
      }),
    );
    expect(response.status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });
});
