// @vitest-environment node
// Opt-in: all migrations and data live in a unique, disposable PostgreSQL schema.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import * as config from '@/lib/api/server-config';
import { database } from '@/lib/server/database';
import {
  hashToken,
  loginWithWechat,
  consumeLoginTicket,
  requireUser,
  SESSION_COOKIE,
} from '@/lib/server/auth';
import { POST as guestLogin } from '@/app/api/auth/guest/route';
import { GET as me, PATCH as updateMe } from '@/app/api/auth/me/route';
import { PUT as favorite } from '@/app/api/favorites/[cardId]/route';
import { GET as dailyGet, POST as dailyVisit } from '@/app/api/daily/[date]/route';
import { GET as agentSession, PUT as saveAgentSession } from '@/app/api/agent-session/route';
import { GET as wallet, POST as purchase } from '@/app/api/payments/route';
import { allCards } from '@/lib/tarot/cards';
import { GET as tourGet, PUT as tourPut } from '@/app/api/product-tour/route';

const enabled = process.env.TAROT_DB_TEST === '1';
const schema = `guest_test_${randomUUID().replaceAll('-', '')}`;
let admin: pg.Client;
let created = false;
const credential = randomBytes(32).toString('hex');
let token: string;
const preMigrationUser = randomUUID();

function request(path: string, session?: string, body?: object) {
  return new NextRequest(`http://localhost${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { ...(session ? { Cookie: `${SESSION_COOKIE}=${session}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function login(value: string) {
  const response = await guestLogin(request('/api/auth/guest', undefined, { credential: value }));
  expect(response.status).toBe(200);
  if (!(response instanceof NextResponse)) throw new Error('Guest login did not set a session');
  const cookie = response.cookies.get(SESSION_COOKIE);
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
  expect(response.headers.get('cache-control')).toBe('no-store');
  return cookie!.value;
}

describe.skipIf(!enabled)('browser guests with real PostgreSQL sessions', () => {
  beforeAll(async () => {
    const original = config.getServerSetting;
    const connectionString = original('DATABASE_URL');
    admin = new pg.Client({ connectionString, connectionTimeoutMillis: 10000 });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    created = true;
    await admin.query(`SET search_path TO ${schema}`);
    for (const file of (await readdir('database'))
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .sort()) {
      if (file === '020_product_tours.sql') {
        await admin.query(
          "INSERT INTO tarot_users (id, nickname, created_at) VALUES ($1, 'migration fixture', '2019-01-01')",
          [preMigrationUser],
        );
        // A same-named constraint on another relation must not bypass our check.
        await admin.query(`CREATE TABLE constraint_fixture (
          value integer CONSTRAINT tarot_users_product_tour_state_check CHECK (value > 0)
        )`);
      }
      await admin.query(await readFile(`database/${file}`, 'utf8'));
    }
    // Re-running the new migration is safe for existing users.
    await admin.query(await readFile('database/018_guest_accounts.sql', 'utf8'));
    await admin.query(
      `INSERT INTO tarot_image_assets (asset_key, kind, object_key, url, content_type, byte_size, sha256)
      VALUES ('/avatars/default.svg', 'static', 'test-avatar', 'https://images.example/default.svg', 'image/svg+xml', 1, $1)`,
      ['a'.repeat(64)],
    );
    const scopedUrl = new URL(connectionString);
    scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
    vi.spyOn(config, 'getServerSetting').mockImplementation((key) =>
      key === 'DATABASE_URL'
        ? scopedUrl.toString()
        : key === 'WECHAT_APP_ID'
          ? 'guest-test-app'
          : key === 'WECHAT_APP_SECRET'
            ? 'test-only'
            : original(key),
    );
    token = await login(credential);
  }, 30000);

  afterAll(async () => {
    if (created) {
      await database().end();
      await admin.query('ROLLBACK');
      // schema is generated above, never taken from configuration or user input.
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    }
    await admin?.end();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('stores only credential hashes and reuses the guest across sessions', async () => {
    const user = await requireUser(request('/', token));
    expect(user).toMatchObject({ isGuest: true, nickname: '游客', creditBalance: 0 });
    const stored = (
      await database().query(
        'SELECT guest_token_hash, wechat_app_id, wechat_open_id FROM tarot_users WHERE id=$1',
        [user.id],
      )
    ).rows[0];
    expect(stored).toEqual({
      guest_token_hash: hashToken(credential),
      wechat_app_id: null,
      wechat_open_id: null,
    });
    const repeated = await login(credential);
    expect(repeated).not.toBe(token);
    expect((await requireUser(request('/', repeated))).id).toBe(user.id);
    const profile = await (await me(request('/api/auth/me', token))).json();
    expect(profile.user.isGuest).toBe(true);
    expect(JSON.stringify(profile)).not.toMatch(/guest_token_hash|wechat_open_id|token_hash/);
    expect(profile.user.id).toBeUndefined();
  });

  it('allows nickname changes and keeps the guest marker', async () => {
    const response = await updateMe(
      new NextRequest('http://localhost/api/auth/me', {
        method: 'PATCH',
        headers: { Cookie: `${SESSION_COOKIE}=${token}` },
        body: JSON.stringify({ nickname: '网页测试旅人' }),
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).user).toMatchObject({ nickname: '网页测试旅人', isGuest: true });
  });

  it('isolates favorites, daily notes and chat state between guest accounts', async () => {
    const another = await login(randomBytes(32).toString('hex'));
    const cardId = allCards[0].id;
    expect(
      (
        await favorite(
          new NextRequest(`http://localhost/api/favorites/${cardId}`, {
            method: 'PUT',
            headers: { Cookie: `${SESSION_COOKIE}=${token}` },
          }),
          { params: Promise.resolve({ cardId }) },
        )
      ).status,
    ).toBe(200);
    expect((await requireUser(request('/', token))).favoriteCardIds).toEqual([cardId]);
    expect((await requireUser(request('/', another))).favoriteCardIds).toEqual([]);
    const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    const context = { params: Promise.resolve({ date }) };
    expect((await dailyVisit(request(`/api/daily/${date}`, token, {}), context)).status).toBe(200);
    expect(
      (await (await dailyGet(request(`/api/daily/${date}`, another), context)).json()).entry,
    ).toBeNull();
    const state = {
      tasks: [{ id: randomUUID(), readingId: randomUUID(), question: '游客的私人问题' }],
      revision: 0,
    };
    expect(
      (
        await saveAgentSession(
          new NextRequest('http://localhost/api/agent-session', {
            method: 'PUT',
            headers: { Cookie: `${SESSION_COOKIE}=${token}` },
            body: JSON.stringify(state),
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (await (await agentSession(request('/api/agent-session', another))).json()).tasks,
    ).toEqual([]);
  });

  it('does not allow a guest to create WeChat payment orders', async () => {
    const response = await wallet(request('/api/payments', token));
    expect(await response.json()).toMatchObject({ enabled: false, guest: true });
    expect((await purchase(request('/api/payments', token, { planId: 'anything' }))).status).toBe(
      403,
    );
    expect(
      (await database().query('SELECT count(*) FROM tarot_payment_orders')).rows[0].count,
    ).toBe('0');
  });

  it('preserves WeChat login after allowing nullable identity fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ openid: 'wechat-user' })));
    const session = await consumeLoginTicket(await loginWithWechat('test-code'));
    const user = await requireUser(request('/', session));
    expect(user.isGuest).toBe(false);
    expect(user.id).not.toBe((await requireUser(request('/', token))).id);
  });

  it('persists versioned tour outcomes across sessions, with isolated ownership and monotonic concurrent writes', async () => {
    const current = await requireUser(request('/', token));
    const savedState = async (id = current.id) =>
      (
        await database().query(
          'SELECT product_tour_version, product_tour_status FROM tarot_users WHERE id = $1',
          [id],
        )
      ).rows[0];
    expect(await savedState(preMigrationUser)).toEqual({
      product_tour_version: 0,
      product_tour_status: null,
    });
    expect(await savedState()).toEqual({ product_tour_version: 0, product_tour_status: null });
    // Simulate an existing account: registration age must not affect eligibility.
    await database().query("UPDATE tarot_users SET created_at = '2019-01-01' WHERE id = $1", [
      current.id,
    ]);
    const state = await (await tourGet(request('/api/product-tour', token))).json();
    expect(state).toMatchObject({ version: 1, status: null });
    expect(state.accountScope).toMatch(/^[a-f0-9]{64}$/);
    expect(state.accountScope).not.toBe(current.id);
    const save = (session: string, status: string, binding = state.accountScope) =>
      tourPut(
        new NextRequest('http://localhost/api/product-tour', {
          method: 'PUT',
          headers: { Cookie: `${SESSION_COOKIE}=${session}` },
          body: JSON.stringify({ version: 1, accountScope: binding, status }),
        }),
      );
    expect((await save(token, 'skipped')).status).toBe(200);
    const initial = await savedState();
    expect(initial).toEqual({ product_tour_version: 1, product_tour_status: 'skipped' });
    await save(token, 'skipped');
    expect(await savedState()).toEqual(initial);
    await Promise.all([save(token, 'completed'), save(token, 'skipped'), save(token, 'completed')]);
    expect(
      await (await tourGet(request('/api/product-tour', await login(credential)))).json(),
    ).toMatchObject({ status: 'completed', accountScope: state.accountScope });
    const completed = await savedState();
    expect(await (await save(token, 'skipped')).json()).toMatchObject({ status: 'completed' });
    await save(token, 'completed');
    await admin.query(await readFile('database/020_product_tours.sql', 'utf8'));
    expect(await savedState()).toEqual(completed);
    // Login and profile updates share the row but must preserve tour state.
    const [profile] = await Promise.all([
      updateMe(
        new NextRequest('http://localhost/api/auth/me', {
          method: 'PATCH',
          headers: { Cookie: `${SESSION_COOKIE}=${token}` },
          body: JSON.stringify({ nickname: '引导测试旅人' }),
        }),
      ),
      login(credential),
      save(token, 'skipped'),
    ]);
    expect(await savedState()).toEqual(completed);
    const publicUser = (await profile.json()).user;
    expect(publicUser.nickname).toBe('引导测试旅人');
    expect(JSON.stringify(publicUser)).not.toMatch(/product_tour|productTour|accountScope/);
    expect(
      (
        await updateMe(
          new NextRequest('http://localhost/api/auth/me', {
            method: 'PATCH',
            headers: { Cookie: `${SESSION_COOKIE}=${token}` },
            body: JSON.stringify({ product_tour_version: 0, product_tour_status: null }),
          }),
        )
      ).status,
    ).toBe(400);

    // A stale deployed version must neither re-show nor overwrite a future outcome.
    for (const status of ['completed', 'skipped']) {
      await database().query(
        'UPDATE tarot_users SET product_tour_version = 2, product_tour_status = $2 WHERE id = $1',
        [current.id, status],
      );
      expect(await (await tourGet(request('/api/product-tour', token))).json()).toMatchObject({
        status,
      });
      await Promise.all([save(token, 'skipped'), save(token, 'completed')]);
      expect(await savedState()).toEqual({ product_tour_version: 2, product_tour_status: status });
    }

    const other = await login(randomBytes(32).toString('hex'));
    expect((await save(other, 'completed')).status).toBe(409);
    expect(await (await tourGet(request('/api/product-tour', other))).json()).toMatchObject({
      status: null,
    });
    expect((await tourGet(request('/api/product-tour'))).status).toBe(401);
    expect(
      (
        await tourPut(
          new NextRequest('http://localhost/api/product-tour', {
            method: 'PUT',
            headers: { Cookie: `${SESSION_COOKIE}=${token}`, origin: 'https://other.example' },
            body: JSON.stringify({ ...state, status: 'skipped' }),
          }),
        )
      ).status,
    ).toBe(403);
    for (const [version, status] of [
      [-1, null],
      [0, 'skipped'],
      [1, null],
      [1, 'started'],
      [null, null],
    ]) {
      await expect(
        database().query(
          'UPDATE tarot_users SET product_tour_version = $2, product_tour_status = $3 WHERE id = $1',
          [current.id, version, status],
        ),
      ).rejects.toMatchObject({ code: version === null ? '23502' : '23514' });
    }
    const constraint = await admin.query(`SELECT convalidated FROM pg_constraint
      WHERE conrelid = 'tarot_users'::regclass AND conname = 'tarot_users_product_tour_state_check'`);
    expect(constraint.rows).toEqual([{ convalidated: true }]);
  });

  it('rejects invalid credentials and cross-site login before creating accounts', async () => {
    for (const invalid of [undefined, '', 'short', 'A'.repeat(64), {}, credential + 'a']) {
      expect(
        (await guestLogin(request('/api/auth/guest', undefined, { credential: invalid }))).status,
      ).toBe(400);
    }
    const response = await guestLogin(
      new NextRequest('http://localhost/api/auth/guest', {
        method: 'POST',
        headers: { origin: 'https://other.example' },
        body: JSON.stringify({ credential }),
      }),
    );
    expect(response.status).toBe(403);
  });
});
