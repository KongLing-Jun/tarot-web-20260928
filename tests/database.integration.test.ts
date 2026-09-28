// @vitest-environment node
// Opt-in integration suite: creates isolated test users, then cascades only their rows.
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import * as config from '@/lib/api/server-config';
import { database } from '@/lib/server/database';
import {
  consumeLoginTicket,
  hashToken,
  loginWithWechat,
  requireUser,
  SESSION_COOKIE,
} from '@/lib/server/auth';
import { GET as me, PATCH as updateMe } from '@/app/api/auth/me/route';
import { GET as consume } from '@/app/api/auth/wechat/consume/route';
import { GET as list, POST as save, DELETE as remove } from '@/app/api/readings/route';
import { GET as detail, PATCH as patch } from '@/app/api/readings/[id]/route';
import { GET as messages, DELETE as removeMessages } from '@/app/api/messages/route';
import { POST as interpret } from '@/app/api/interpret/route';
import { startChatExchange } from '@/lib/server/chat';
import { allCards } from '@/lib/tarot/cards';
import { spreads } from '@/lib/tarot/spreads';
import * as oss from '@/lib/server/oss';
import { getStaticImageUrl } from '@/lib/server/image-assets';
import { GET as dailyList, POST as dailyImport } from '@/app/api/daily/route';
import {
  GET as dailyGet,
  POST as dailyVisit,
  PATCH as dailyPatch,
} from '@/app/api/daily/[date]/route';
import { getDailyDraw, parseDateKey } from '@/lib/tarot/daily';
import { PUT as favorite, DELETE as unfavorite } from '@/app/api/favorites/[cardId]/route';
import { GET as agentSession, PUT as saveAgentSession } from '@/app/api/agent-session/route';

const enabled = process.env.TAROT_DB_TEST === '1';
const testAppId = `integration-${randomUUID()}`;
const id = `reading-${randomUUID()}`;
const context = { params: Promise.resolve({ id }) };
const reading = {
  id,
  question: '数据库测试问题',
  spread: spreads[0],
  drawnCards: [{ card: allCards[0], position: spreads[0].positions[0], isReversed: false }],
  interpretation: '已保存的回复',
  createdAt: new Date().toISOString(),
};
let tokenA: string, tokenB: string, userA: string, userB: string;

function request(path: string, token?: string, method = 'GET', body?: object) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      ...(token ? { Cookie: `${SESSION_COOKIE}=${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function login(openid: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(Response.json({ openid, session_key: 'never-return-this' })),
  );
  const ticket = await loginWithWechat('valid-test-code');
  return consumeLoginTicket(ticket);
}

describe.skipIf(!enabled)('PostgreSQL authenticated persistence', () => {
  beforeAll(async () => {
    const original = config.getServerSetting;
    vi.spyOn(config, 'getServerSetting').mockImplementation((key) =>
      key === 'WECHAT_APP_ID'
        ? testAppId
        : key === 'WECHAT_APP_SECRET'
          ? 'test-secret'
          : original(key),
    );
    tokenA = await login('test-a');
    tokenB = await login('test-b');
    userA = (await requireUser(request('/', tokenA))).id;
    userB = (await requireUser(request('/', tokenB))).id;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    if (enabled) {
      await database().query('DELETE FROM tarot_users WHERE wechat_app_id = $1', [testAppId]);
      await database().end();
    }
    vi.restoreAllMocks();
  });

  it('reuses the user ID on repeat WeChat login and assigns a default profile', async () => {
    const repeated = await login('test-a');
    const response = await me(request('/api/auth/me', repeated));
    const data = await response.json();
    expect(data.user).toEqual({
      isGuest: false,
      nickname: '星旅人',
      avatarUrl: await getStaticImageUrl('/avatars/default.svg'),
      createdAt: expect.any(String),
      readingCount: 0,
      creditBalance: 0,
      favoriteCardIds: [],
    });
    expect((await requireUser(request('/', repeated))).id).toBe(userA);
    expect(JSON.stringify(data)).not.toMatch(/openid|session_key|token_hash|test-secret/);
    expect(userA).not.toBe(userB);
    const row = await database().query(
      'SELECT token_hash FROM tarot_sessions WHERE token_hash = $1',
      [hashToken(repeated)],
    );
    expect(row.rows[0].token_hash).not.toBe(repeated);
  });

  it('returns the available credit balance, isolates accounts and preserves it after profile editing', async () => {
    const balance = async (token: string) =>
      (await (await me(request('/api/auth/me', token))).json()).user.creditBalance;
    expect(await balance(tokenA)).toBe(0);
    await database().query('INSERT INTO tarot_user_credits(user_id,balance) VALUES ($1,300)', [
      userA,
    ]);
    expect(await balance(tokenA)).toBe(300);
    expect(await balance(tokenB)).toBe(0);
    const response = await updateMe(
      request('/api/auth/me', tokenA, 'PATCH', { nickname: '星旅人' }),
    );
    expect((await response.json()).user.creditBalance).toBe(300);
    expect(
      (await updateMe(request('/api/auth/me', tokenA, 'PATCH', { creditBalance: 999 }))).status,
    ).toBe(400);
    expect(await balance(tokenA)).toBe(300);
  });

  it('counts new readings atomically per user without counting retries, edits, or deleting accumulated usage', async () => {
    const count = async (token: string) =>
      (await (await me(request('/api/auth/me', token))).json()).user.readingCount;
    const beforeA = await count(tokenA);
    const beforeB = await count(tokenB);
    const firstId = `count-${randomUUID()}`;
    const secondId = `count-${randomUUID()}`;
    const responses = await Promise.all([
      save(request('/api/readings', tokenA, 'POST', { ...reading, id: firstId })),
      save(request('/api/readings', tokenA, 'POST', { ...reading, id: firstId })),
      save(request('/api/readings', tokenA, 'POST', { ...reading, id: secondId })),
      save(request('/api/readings', tokenB, 'POST', { ...reading, id: firstId })),
    ]);
    responses.forEach((response) => expect(response.status).toBe(200));
    expect(await count(tokenA)).toBe(beforeA + 2);
    expect(await count(tokenB)).toBe(beforeB + 1);
    expect(
      (
        await patch(
          request(`/api/readings/${firstId}`, tokenA, 'PATCH', { interpretation: '更新解读' }),
          { params: Promise.resolve({ id: firstId }) },
        )
      ).status,
    ).toBe(200);
    expect(
      (await remove(request('/api/readings', tokenA, 'DELETE', { ids: [firstId, secondId] })))
        .status,
    ).toBe(200);
    expect(await count(tokenA)).toBe(beforeA + 2);
    expect(
      (await updateMe(request('/api/auth/me', tokenA, 'PATCH', { readingCount: 999 }))).status,
    ).toBe(400);
    expect(await count(tokenB)).toBe(beforeB + 1);
    await remove(request('/api/readings', tokenB, 'DELETE', { ids: [firstId] }));
  });

  it('persists favorites idempotently, isolates accounts, and includes them in profile responses', async () => {
    const cardId = allCards[0].id;
    const ctx = { params: Promise.resolve({ cardId }) };
    const path = `/api/favorites/${cardId}`;
    const favorites = async (token: string) =>
      (await (await me(request('/api/auth/me', token))).json()).user.favoriteCardIds;
    const responses = await Promise.all([
      favorite(request(path, tokenA, 'PUT'), ctx),
      favorite(request(path, tokenA, 'PUT'), ctx),
    ]);
    responses.forEach((response) => expect(response.status).toBe(200));
    expect(await favorites(tokenA)).toEqual([cardId]);
    expect(await favorites(tokenB)).toEqual([]);
    expect(
      (
        await (
          await updateMe(request('/api/auth/me', tokenA, 'PATCH', { nickname: '星旅人' }))
        ).json()
      ).user.favoriteCardIds,
    ).toEqual([cardId]);
    await unfavorite(request(path, tokenB, 'DELETE'), ctx);
    expect(await favorites(tokenA)).toEqual([cardId]);
    const renewed = await login('test-a');
    expect(await favorites(renewed)).toEqual([cardId]);
    expect((await favorite(request(path, undefined, 'PUT'), ctx)).status).toBe(401);
    expect(
      (
        await favorite(request('/api/favorites/invalid', tokenA, 'PUT'), {
          params: Promise.resolve({ cardId: 'invalid' }),
        })
      ).status,
    ).toBe(400);
    const crossSite = request(path, tokenA, 'PUT');
    crossSite.headers.set('origin', 'https://other.example');
    expect((await favorite(crossSite, ctx)).status).toBe(403);
    expect(
      (await updateMe(request('/api/auth/me', tokenA, 'PATCH', { favoriteCardIds: [cardId] })))
        .status,
    ).toBe(400);
    await unfavorite(request(path, tokenA, 'DELETE'), ctx);
    await unfavorite(request(path, tokenA, 'DELETE'), ctx);
    expect(await favorites(tokenA)).toEqual([]);
  });

  it('registers daily cards and edits notes with per-user isolation, including clearing', async () => {
    const date = '2026-09-10';
    const ctx = { params: Promise.resolve({ date }) };
    const path = `/api/daily/${date}`;
    expect((await dailyVisit(request(path, tokenA, 'POST'), ctx)).status).toBe(200);
    const draw = getDailyDraw(parseDateKey(date)!);
    expect((await (await dailyGet(request(path, tokenA), ctx)).json()).entry).toMatchObject({
      cardId: draw.card.id,
      isReversed: draw.isReversed,
    });
    expect(
      (
        await dailyPatch(
          request(path, tokenA, 'PATCH', { note: '用户 A 的札记', userId: userB }),
          ctx,
        )
      ).status,
    ).toBe(200);
    expect((await (await dailyGet(request(path, tokenB), ctx)).json()).entry).toBeNull();
    await dailyPatch(request(path, tokenB, 'PATCH', { note: '用户 B 的札记' }), ctx);
    await dailyPatch(request(path, tokenA, 'PATCH', { note: '' }), ctx);
    expect((await (await dailyGet(request(path, tokenA), ctx)).json()).entry.note).toBe('');
    expect((await (await dailyGet(request(path, tokenB), ctx)).json()).entry.note).toBe(
      '用户 B 的札记',
    );
    expect((await dailyGet(request(path), ctx)).status).toBe(401);
    expect((await dailyList(request('/api/daily?offset=-1', tokenA))).status).toBe(400);
  });

  it('rejects invalid daily dates, oversized notes and cross-site writes', async () => {
    for (const date of ['2026-02-30', '2026-13-01', 'bad-date']) {
      expect(
        (
          await dailyVisit(request(`/api/daily/${date}`, tokenA, 'POST'), {
            params: Promise.resolve({ date }),
          })
        ).status,
      ).toBe(400);
    }
    const ctx = { params: Promise.resolve({ date: '2026-09-10' }) };
    expect(
      (
        await dailyPatch(
          request('/api/daily/2026-09-10', tokenA, 'PATCH', { note: 'a'.repeat(10001) }),
          ctx,
        )
      ).status,
    ).toBe(400);
    const cross = request('/api/daily/2026-09-10', tokenA, 'PATCH', { note: 'x' });
    cross.headers.set('origin', 'https://other.example');
    expect((await dailyPatch(cross, ctx)).status).toBe(403);
  });

  it('imports old notes idempotently without overwriting cloud edits or explicit clears', async () => {
    const notes = [
      { dateKey: '2026-09-08', note: '旧札记' },
      { dateKey: '2026-09-10', note: '不可覆盖清空操作' },
    ];
    expect(
      await (await dailyImport(request('/api/daily', tokenA, 'POST', { notes }))).json(),
    ).toEqual({ imported: ['2026-09-08'] });
    expect(
      await (await dailyImport(request('/api/daily', tokenA, 'POST', { notes }))).json(),
    ).toEqual({ imported: [] });
    const saved = await (await dailyList(request('/api/daily', tokenA))).json();
    expect(saved.entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ dateKey: '2026-09-08', note: '旧札记' })]),
    );
  });

  it('checkpoints daily interpretation independently of notes and prevents stale streams overwriting a newer request', async () => {
    const date = '2026-09-08';
    const ctx = { params: Promise.resolve({ date }) };
    const context = { daily: { dateKey: date, dateStr: '2026.09.08' } };
    const old = await startChatExchange(userA, '旧每日请求', context);
    const latest = await startChatExchange(userA, '新每日请求', context);
    const chunk = (content: string) =>
      new TextEncoder().encode(
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
      );
    await latest.append(chunk('最新的部分解读'));
    await dailyPatch(
      request(`/api/daily/${date}`, tokenA, 'PATCH', { note: '同步编辑的札记' }),
      ctx,
    );
    await latest.finish('cancelled');
    await old.append(chunk('过期结果'));
    await old.finish();
    const entry = (await (await dailyGet(request(`/api/daily/${date}`, tokenA), ctx)).json()).entry;
    expect(entry).toMatchObject({
      interpretation: '最新的部分解读',
      interpretationStatus: 'cancelled',
      note: '同步编辑的札记',
    });
  });

  it('stores agent streams, questions and interrupted output through the real interpret route', async () => {
    const upstream = 'data: {"choices":[{"delta":{"content":"智能模式的部分回复"}}]}\n\n';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(upstream)));
    const response = await interpret(
      request('/api/interpret', tokenA, 'POST', {
        question: '智能模式测试问题',
        agent: { prompt: '测试解读' },
      }),
    );
    expect(response.status).toBe(200);
    await response.text();
    const rows = await database().query(
      "SELECT role, content, status FROM tarot_chat_messages WHERE user_id = $1 AND context->>'question' = $2",
      [userA, '智能模式测试问题'],
    );
    expect(rows.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: '智能模式测试问题' }),
        expect.objectContaining({
          role: 'assistant',
          content: '智能模式的部分回复',
          status: 'error',
        }),
      ]),
    );
  });

  it('saves daily AI through the HTTP route and restores it by date', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            'data: {"choices":[{"delta":{"content":"可恢复的每日解读"}}]}\n\ndata: [DONE]\n\n',
          ),
        ),
    );
    const date = '2026-09-07';
    const response = await interpret(
      request('/api/interpret', tokenA, 'POST', {
        daily: { dateKey: date, dateStr: '2026.09.07', cardName: 'fake', cardNameCn: '错误牌名' },
      }),
    );
    expect(response.status).toBe(200);
    await response.text();
    const entry = (
      await (
        await dailyGet(request(`/api/daily/${date}`, tokenA), { params: Promise.resolve({ date }) })
      ).json()
    ).entry;
    expect(entry).toMatchObject({
      interpretation: '可恢复的每日解读',
      interpretationStatus: 'done',
      cardId: getDailyDraw(parseDateKey(date)!).card.id,
    });
  });

  it('retains pending supplementary cards and failed follow-ups in reading history', async () => {
    const pendingId = `pending-${randomUUID()}`;
    const followUps = [
      {
        id: 'pending-follow-up',
        question: '等待翻开的补牌',
        status: 'awaiting-reveal',
        decision: 'draw',
        additionalCards: reading.drawnCards,
        interpretation: '',
        error: null,
      },
    ];
    expect(
      (
        await save(
          request('/api/readings', tokenA, 'POST', { ...reading, id: pendingId, followUps }),
        )
      ).status,
    ).toBe(200);
    const ctx = { params: Promise.resolve({ id: pendingId }) };
    const data = (await (await detail(request(`/api/readings/${pendingId}`, tokenA), ctx)).json())
      .reading;
    expect(data.followUps[0]).toMatchObject({
      status: 'awaiting-reveal',
      additionalCards: reading.drawnCards,
    });
    await patch(
      request(`/api/readings/${pendingId}`, tokenA, 'PATCH', {
        followUps: [
          { ...followUps[0], status: 'error', interpretation: '部分回答', error: '连接中断' },
        ],
      }),
      ctx,
    );
    expect(
      (await (await detail(request(`/api/readings/${pendingId}`, tokenA), ctx)).json()).reading
        .followUps[0],
    ).toMatchObject({ status: 'error', interpretation: '部分回答' });
  });

  it('checkpoints the main reading while retaining independent follow-up edits', async () => {
    const savedId = `checkpoint-${randomUUID()}`;
    await save(
      request('/api/readings', tokenA, 'POST', { ...reading, id: savedId, interpretation: '' }),
    );
    const recorder = await startChatExchange(userA, '占卜中断测试', { readingId: savedId });
    await recorder.append(
      new TextEncoder().encode(
        'data: {"choices":[{"delta":{"content":"保留的部分占卜解读"}}]}\n\n',
      ),
    );
    await recorder.finish('cancelled');
    expect(
      (
        await (
          await detail(request(`/api/readings/${savedId}`, tokenA), {
            params: Promise.resolve({ id: savedId }),
          })
        ).json()
      ).reading.interpretation,
    ).toBe('保留的部分占卜解读');
  });

  it('redeems a ticket once and creates a private cookie with a clean redirect', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ openid: 'test-a' })));
    const ticket = await loginWithWechat('code');
    const response = await consume(request(`/api/auth/wechat/consume?ticket=${ticket}`));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/');
    expect(response.headers.get('set-cookie')).toMatch(/HttpOnly/);
    expect(response.headers.get('set-cookie')).toMatch(/SameSite=lax/i);
    await expect(consumeLoginTicket(ticket)).rejects.toMatchObject({ status: 401 });
  });

  it('returns renewed logins to the original page and rejects external redirect destinations', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ openid: 'test-a' })),
    );
    for (const [next, expected] of [
      ['/profile?wechat_retry=1', '/profile?wechat_retry=1'],
      ['https://other.example', '/'],
    ]) {
      const ticket = await loginWithWechat('code');
      const response = await consume(
        request(`/api/auth/wechat/consume?ticket=${ticket}&next=${encodeURIComponent(next)}`),
      );
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(expected);
      expect(response.headers.get('set-cookie')).toMatch(/HttpOnly/);
    }
  });

  it('rejects expired tickets, expired sessions and forged user identities', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ openid: 'test-a' })));
    const ticket = await loginWithWechat('code');
    await database().query(
      "UPDATE tarot_login_tickets SET expires_at = now() - interval '1 second' WHERE token_hash = $1",
      [hashToken(ticket)],
    );
    await expect(consumeLoginTicket(ticket)).rejects.toMatchObject({ status: 401 });
    const token = await login('test-a');
    await database().query(
      "UPDATE tarot_sessions SET expires_at = now() - interval '1 second' WHERE token_hash = $1",
      [hashToken(token)],
    );
    expect((await me(request('/api/auth/me', token))).status).toBe(401);
    expect((await list(request(`/api/readings?userId=${userA}`, 'f'.repeat(64)))).status).toBe(401);
    expect((await interpret(request('/api/interpret', undefined, 'POST', reading))).status).toBe(
      401,
    );
  });

  it('rejects bad WeChat codes without creating an identity', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ errcode: 40029, errmsg: 'invalid code' })),
    );
    await expect(loginWithWechat('bad-code')).rejects.toMatchObject({ status: 401 });
    await expect(loginWithWechat('')).rejects.toMatchObject({ status: 400 });
  });

  it('saves and reads rich reading data only for its owner', async () => {
    expect(
      (await save(request('/api/readings', tokenA, 'POST', { ...reading, userId: userB }))).status,
    ).toBe(200);
    expect((await detail(request(`/api/readings/${id}`, tokenB), context)).status).toBe(404);
    const data = await (await detail(request(`/api/readings/${id}`, tokenA), context)).json();
    expect(data.reading.question).toBe(reading.question);
    expect(data.reading.drawnCards[0].card.id).toBe(allCards[0].id);
    expect((await (await list(request('/api/readings', tokenB))).json()).readings).toEqual([]);
  });

  it('patches interpretation and follow-ups without losing either field', async () => {
    const followUps = [
      {
        id: 'followup-1',
        question: '追问',
        status: 'done',
        decision: 'direct',
        additionalCards: [],
        interpretation: '追问回复',
      },
    ];
    await Promise.all([
      patch(
        request(`/api/readings/${id}`, tokenA, 'PATCH', { interpretation: '重新生成的回复' }),
        context,
      ),
      patch(request(`/api/readings/${id}`, tokenA, 'PATCH', { followUps }), context),
    ]);
    const data = await (await detail(request(`/api/readings/${id}`, tokenA), context)).json();
    expect(data.reading).toMatchObject({
      interpretation: '重新生成的回复',
      followUps: [{ question: '追问', interpretation: '追问回复' }],
    });
    expect(
      (
        await patch(
          request(`/api/readings/${id}`, tokenB, 'PATCH', { interpretation: 'other' }),
          context,
        )
      ).status,
    ).toBe(404);
  });

  it('rejects malformed nested readings and cross-site writes', async () => {
    expect(
      (await save(request('/api/readings', tokenA, 'POST', { ...reading, drawnCards: [null] })))
        .status,
    ).toBe(400);
    const crossSite = request('/api/readings', tokenA, 'DELETE', { all: true });
    crossSite.headers.set('origin', 'https://other.example');
    expect((await remove(crossSite)).status).toBe(403);
  });

  it('does not let another user delete a reading, including a shared client ID', async () => {
    await remove(request('/api/readings', tokenB, 'DELETE', { ids: [id] }));
    expect((await detail(request(`/api/readings/${id}`, tokenA), context)).status).toBe(200);
    await save(request('/api/readings', tokenB, 'POST', { ...reading, question: '用户 B' }));
    await remove(request('/api/readings', tokenB, 'DELETE', { all: true }));
    expect((await detail(request(`/api/readings/${id}`, tokenA), context)).status).toBe(200);
  });

  it('persists UTF-8 split stream output and retains cancelled partial responses', async () => {
    const recorder = await startChatExchange(userA, '流式问题', {});
    const encoded = new TextEncoder().encode(
      'data: {"choices":[{"delta":{"content":"星光回复"}}]}\r\n\r\ndata: [DONE]\n\n',
    );
    for (const byte of encoded) await recorder.append(new Uint8Array([byte]));
    await recorder.finish();
    const partial = await startChatExchange(userA, '中断问题', {});
    await partial.append(
      new TextEncoder().encode('data: {"choices":[{"delta":{"content":"尚未完成"}}]}\n\n'),
    );
    await partial.finish('cancelled');
    const rows = (await (await messages(request('/api/messages', tokenA))).json()).messages;
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: '流式问题', status: 'done' }),
        expect.objectContaining({ role: 'assistant', content: '星光回复', status: 'done' }),
        expect.objectContaining({ role: 'assistant', content: '尚未完成', status: 'cancelled' }),
      ]),
    );
    expect((await (await messages(request('/api/messages', tokenB))).json()).messages).toEqual([]);
  });

  it('saves server-generated responses even without the browser saving a reading', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            'data: {"choices":[{"delta":{"content":"服务器直接存档"}}]}\n\ndata: [DONE]\n\n',
          ),
        ),
    );
    const response = await interpret(request('/api/interpret', tokenA, 'POST', reading));
    expect(response.status).toBe(200);
    await response.text();
    const rows = (await (await messages(request('/api/messages', tokenA))).json()).messages;
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: '服务器直接存档', status: 'done' }),
      ]),
    );
  });

  it('deduplicates repeated operation IDs and isolates them by user', async () => {
    const operationId = randomUUID();
    const payload = { ...reading, operationId, attemptId: randomUUID() };
    const upstream = vi
      .fn()
      .mockImplementation(
        async () => new Response('data: {"content":"幂等回复"}\n\ndata: [DONE]\n\n'),
      );
    vi.stubGlobal('fetch', upstream);
    await (await interpret(request('/api/interpret', tokenA, 'POST', payload))).text();
    const replay = await interpret(
      request('/api/interpret', tokenA, 'POST', { ...payload, attemptId: randomUUID() }),
    );
    expect(await replay.text()).toContain('幂等回复');
    expect(upstream).toHaveBeenCalledTimes(1);
    const conflict = await interpret(
      request('/api/interpret', tokenA, 'POST', { ...payload, question: '不同问题' }),
    );
    expect(conflict.status).toBe(409);
    await (await interpret(request('/api/interpret', tokenB, 'POST', payload))).text();
    expect(upstream).toHaveBeenCalledTimes(2);
    const rows = await database().query(
      `SELECT user_id FROM tarot_chat_messages WHERE context->>'operationId' = $1`,
      [operationId],
    );
    expect(rows.rows).toHaveLength(4);
    await database().query(
      `DELETE FROM tarot_chat_messages WHERE user_id = ANY($1) AND context->>'operationId' = $2`,
      [[userA, userB], operationId],
    );
  });

  it('rejects a concurrent attempt and reuses the exchange after an empty failed attempt', async () => {
    const operationId = randomUUID();
    const attemptId = randomUUID();
    const context = { operationId, attemptId };
    const initial = await startChatExchange(userA, '重试空结果', context);
    await expect(
      startChatExchange(userA, '重试空结果', { ...context, attemptId: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    await initial.finish('error');
    const first = await database().query(
      `SELECT exchange_id FROM tarot_chat_messages WHERE user_id = $1 AND role = 'assistant'
      AND context->>'operationId' = $2`,
      [userA, operationId],
    );
    const retry = await startChatExchange(userA, '重试空结果', {
      ...context,
      attemptId: randomUUID(),
    });
    await retry.append(
      new TextEncoder().encode('data: {"content":"重试答案"}\n\ndata: [DONE]\n\n'),
    );
    await retry.finish();
    const messages = await database().query(
      `SELECT exchange_id, role, status, content FROM tarot_chat_messages WHERE user_id = $1
      AND context->>'operationId' = $2`,
      [userA, operationId],
    );
    expect(messages.rows).toHaveLength(2);
    expect(messages.rows.every((row) => row.exchange_id === first.rows[0].exchange_id)).toBe(true);
    expect(messages.rows.find((row) => row.role === 'assistant')).toMatchObject({
      status: 'done',
      content: '重试答案',
    });
  });

  it('prevents a superseded attempt from overwriting the transcript', async () => {
    const operationId = randomUUID();
    const recorder = await startChatExchange(userA, '旧尝试', {
      operationId,
      attemptId: randomUUID(),
    });
    await database().query(
      `UPDATE tarot_chat_messages SET context = context || jsonb_build_object('attemptId', $3::text)
      WHERE user_id = $1 AND context->>'operationId' = $2`,
      [userA, operationId, randomUUID()],
    );
    await recorder.append(
      new TextEncoder().encode('data: {"content":"旧尝试答案"}\n\ndata: [DONE]\n\n'),
    );
    await recorder.finish();
    const rows = await database().query(
      `SELECT content, status FROM tarot_chat_messages WHERE user_id = $1 AND role = 'assistant'
      AND context->>'operationId' = $2`,
      [userA, operationId],
    );
    expect(rows.rows[0]).toEqual({ content: '', status: 'pending' });
  });

  it.each([
    ['reasoning_content', '只有思考', 'stop', 'no-valid-answer'],
    ['content', '被截断的正文', 'length', 'truncated'],
    ['content', '终帧完整正文', 'stop', 'completed'],
  ])(
    'persists accurate generation state for %s / %s / %s',
    async (field, text, finishReason, expected) => {
      const question = randomUUID();
      const recorder = await startChatExchange(userA, question, {});
      await recorder.append(
        new TextEncoder().encode(
          `data: ${JSON.stringify({ choices: [{ delta: { [field]: text }, finish_reason: finishReason }] })}\n\n`,
        ),
      );
      await recorder.finish();
      const rows = await database().query(
        `SELECT content, status, context->>'generationStatus' AS generation FROM tarot_chat_messages
      WHERE user_id = $1 AND role = 'assistant' AND exchange_id IN
        (SELECT exchange_id FROM tarot_chat_messages WHERE user_id = $1 AND content = $2 AND role = 'user')`,
        [userA, question],
      );
      expect(rows.rows[0]).toMatchObject({
        status: expected === 'completed' ? 'done' : 'error',
        generation: expected,
      });
      expect(rows.rows[0].content).toContain(text);
    },
  );

  it('retains the user question when the upstream service fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('failure', { status: 500 })));
    expect(
      (
        await interpret(
          request('/api/interpret', tokenA, 'POST', { ...reading, question: '失败的问题' }),
        )
      ).status,
    ).toBe(502);
    const rows = (await (await messages(request('/api/messages', tokenA))).json()).messages;
    expect(rows).toEqual(
      expect.arrayContaining([expect.objectContaining({ content: '失败的问题', role: 'user' })]),
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: '', status: 'error', role: 'assistant' }),
      ]),
    );
  });

  it('finalizes the saved response when the HTTP reader is cancelled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"choices":[{"delta":{"content":"取消前的内容"}}]}\n\n',
                ),
              );
            },
          }),
        ),
      ),
    );
    const response = await interpret(request('/api/interpret', tokenA, 'POST', reading));
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    const rows = (await (await messages(request('/api/messages', tokenA))).json()).messages;
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: '取消前的内容', status: 'cancelled' }),
      ]),
    );
  });

  it('marks unexpected stream EOF as incomplete while retaining the partial text', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('data: {"choices":[{"delta":{"content":"异常断流的内容"}}]}\n\n'),
        ),
    );
    const response = await interpret(request('/api/interpret', tokenA, 'POST', reading));
    await response.text();
    const rows = (await (await messages(request('/api/messages', tokenA))).json()).messages;
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: '异常断流的内容', status: 'error' }),
      ]),
    );
  });

  it('persists profile changes across login without moving histories or sessions', async () => {
    // Exercise the real asset table without leaving test objects in the live bucket.
    const upload = vi
      .spyOn(oss, 'putOssImage')
      .mockImplementation(async (key) => oss.ossObjectUrl(key));
    const nickname = '你好1 🌙';
    const image = await sharp({
      create: { width: 16, height: 16, channels: 3, background: '#dbbf7a' },
    })
      .png()
      .toBuffer();
    const response = await updateMe(
      request('/api/auth/me', tokenA, 'PATCH', {
        nickname,
        avatarUrl: `data:image/png;base64,${image.toString('base64')}`,
      }),
    );
    expect(response.status).toBe(200);
    const updated = (await response.json()).user;
    expect(updated.nickname).toBe(nickname);
    expect(updated).not.toHaveProperty('id');
    expect(updated).not.toHaveProperty('publicId');
    expect(updated.avatarUrl).toMatch(/^https:\/\//);
    const asset = await database().query(
      'SELECT user_id, content_type FROM tarot_image_assets WHERE url = $1',
      [updated.avatarUrl],
    );
    expect(asset.rows[0]).toEqual({ user_id: userA, content_type: 'image/webp' });
    expect(upload).toHaveBeenCalledOnce();
    upload.mockRestore();
    const repeated = await login('test-a');
    expect((await (await me(request('/api/auth/me', repeated))).json()).user).toMatchObject({
      nickname,
      avatarUrl: updated.avatarUrl,
    });
    expect((await requireUser(request('/', repeated))).id).toBe(userA);
    expect((await detail(request(`/api/readings/${id}`, repeated), context)).status).toBe(200);
    expect((await updateMe(request('/api/auth/me', tokenB, 'PATCH', { nickname }))).status).toBe(
      200,
    );
    expect((await requireUser(request('/', tokenB))).id).toBe(userB);
    expect(
      (await updateMe(request('/api/auth/me', tokenA, 'PATCH', { nickname: '' }))).status,
    ).toBe(400);
    expect((await updateMe(request('/api/auth/me', tokenA, 'PATCH', { id: userB }))).status).toBe(
      400,
    );
    expect(
      (await updateMe(request('/api/auth/me', undefined, 'PATCH', { nickname: 'seeker' }))).status,
    ).toBe(401);
    const crossSite = request('/api/auth/me', tokenA, 'PATCH', { nickname: 'seeker' });
    crossSite.headers.set('origin', 'https://other.example');
    expect((await updateMe(crossSite)).status).toBe(403);
    expect((await (await me(request('/api/auth/me', tokenA))).json()).user.nickname).toBe(nickname);
    expect(
      (await (await messages(request('/api/messages', repeated))).json()).messages.length,
    ).toBeGreaterThan(0);
  });

  it('clears only the authenticated user’s chat history', async () => {
    const exchange = await startChatExchange(userB, '保留 B 的消息', {});
    await exchange.finish('cancelled');
    await removeMessages(request('/api/messages', tokenA, 'DELETE', { all: true }));
    expect((await (await messages(request('/api/messages', tokenA))).json()).messages).toEqual([]);
    expect((await (await messages(request('/api/messages', tokenB))).json()).messages).toHaveLength(
      2,
    );
  });
  it('persists account-scoped task references before drawing and rejects stale concurrent writes', async () => {
    const taskId = `task-${randomUUID()}`;
    const path = '/api/agent-session';
    const tasks = [{ id: taskId, readingId: taskId, question: '尚未抽牌的问题' }];
    expect((await agentSession(request(path))).status).toBe(401);
    expect(
      (await saveAgentSession(request(path, tokenA, 'PUT', { tasks, revision: 0 }))).status,
    ).toBe(200);
    expect(await (await agentSession(request(path, tokenA))).json()).toMatchObject({
      revision: 1,
      tasks: [{ ...tasks[0], reading: null }],
    });
    expect(await (await agentSession(request(path, tokenB))).json()).toEqual({
      tasks: [],
      revision: 0,
    });
    const concurrent = await Promise.all([
      saveAgentSession(request(path, tokenA, 'PUT', { tasks, revision: 1 })),
      saveAgentSession(request(path, tokenA, 'PUT', { tasks, revision: 1 })),
    ]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([200, 409]);
    const cross = request(path, tokenA, 'PUT', { tasks: [], revision: 2 });
    cross.headers.set('origin', 'https://other.example');
    expect((await saveAgentSession(cross)).status).toBe(403);
    expect(
      (
        await saveAgentSession(
          request(path, tokenA, 'PUT', { tasks: [tasks[0], tasks[0]], revision: 2 }),
        )
      ).status,
    ).toBe(400);
    await database().query('DELETE FROM tarot_agent_sessions WHERE user_id = $1', [userA]);
  });

  it('restores tasks using database replies and retains completion after a client saves the reading', async () => {
    const readingId = `task-reading-${randomUUID()}`;
    const path = '/api/agent-session';
    await save(request('/api/readings', tokenA, 'POST', { ...reading, id: readingId }));
    const recorder = await startChatExchange(userA, reading.question, { readingId });
    await recorder.append(
      new TextEncoder().encode(
        'data: {"choices":[{"delta":{"content":"数据库回复"}}]}\n\ndata: [DONE]\n\n',
      ),
    );
    await recorder.finish();
    await save(
      request('/api/readings', tokenA, 'POST', {
        ...reading,
        id: readingId,
        interpretation: '数据库回复',
      }),
    );
    const tasks = [{ id: 'agent', readingId, question: reading.question }];
    await saveAgentSession(request(path, tokenA, 'PUT', { tasks, revision: 0 }));
    expect(await (await agentSession(request(path, tokenA))).json()).toMatchObject({
      tasks: [{ completion: 'complete', reading: { interpretation: '数据库回复' } }],
    });
    // Same reference under another account cannot read this user's data.
    await saveAgentSession(request(path, tokenB, 'PUT', { tasks, revision: 0 }));
    expect(await (await agentSession(request(path, tokenB))).json()).toMatchObject({
      tasks: [{ reading: null }],
    });
    await saveAgentSession(request(path, tokenA, 'PUT', { tasks: [], revision: 1 }));
    expect(await (await agentSession(request(path, tokenA))).json()).toMatchObject({ tasks: [] });
    expect(
      (
        await detail(request(`/api/readings/${readingId}`, tokenA), {
          params: Promise.resolve({ id: readingId }),
        })
      ).status,
    ).toBe(200);
    await database().query('DELETE FROM tarot_agent_sessions WHERE user_id = ANY($1::uuid[])', [
      [userA, userB],
    ]);
    await remove(request('/api/readings', tokenA, 'DELETE', { ids: [readingId] }));
  });

  it('saves follow-up output without a browser PATCH and prevents an older stream overwriting a new reply', async () => {
    const readingId = `follow-up-${randomUUID()}`;
    const followUps = [
      {
        id: 'fu',
        question: '下一步呢',
        status: 'interpreting',
        additionalCards: [],
        interpretation: '',
        error: null,
      },
    ];
    await save(request('/api/readings', tokenA, 'POST', { ...reading, id: readingId, followUps }));
    const ctx = { readingId, followUp: { id: 'fu', decision: 'direct', additionalCards: [] } };
    const old = await startChatExchange(userA, '下一步呢', ctx);
    const latest = await startChatExchange(userA, '下一步呢', ctx);
    // A browser leaving the page may submit its last snapshot during the stream.
    await patch(request(`/api/readings/${readingId}`, tokenA, 'PATCH', { followUps }), {
      params: Promise.resolve({ id: readingId }),
    });
    await latest.append(
      new TextEncoder().encode('data: {"choices":[{"delta":{"content":"新追问片段"}}]}\n\n'),
    );
    await latest.finish('cancelled');
    await old.append(
      new TextEncoder().encode(
        'data: {"choices":[{"delta":{"content":"旧追问"}}]}\n\ndata: [DONE]\n\n',
      ),
    );
    await old.finish();
    const result = await (
      await detail(request(`/api/readings/${readingId}`, tokenA), {
        params: Promise.resolve({ id: readingId }),
      })
    ).json();
    expect(result.reading.followUps[0]).toMatchObject({
      interpretation: '新追问片段',
      status: 'error',
      decision: 'direct',
    });
    await remove(request('/api/readings', tokenA, 'DELETE', { ids: [readingId] }));
  });
});
