// @vitest-environment node
// Opt-in; the only DDL runs inside a freshly generated disposable schema.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as config from '@/lib/api/server-config';
import { database } from '@/lib/server/database';
import { getIntentSnapshot, saveIntentSnapshot } from '@/lib/server/intent-store';
import type { IntentSnapshot } from '@/lib/intent/types';

const enabled = process.env.TAROT_DB_TEST === '1';
const schema = `intent_test_${randomUUID().replaceAll('-', '')}`;
const userA = randomUUID();
const userB = randomUUID();
let admin: pg.Client;
let created = false;
let poolCreated = false;

function snapshot(revision = 1): IntentSnapshot {
  return {
    id: randomUUID(),
    version: 1,
    revision,
    question: '怎么准备面试',
    messages: [{ id: 'message', text: '怎么准备面试' }],
    candidate: {
      task: 'prepare',
      turnAction: 'new',
      subject: null,
      goal: null,
      facts: [],
      constraints: [],
      wantsAdvice: true,
      missingInformation: [],
    },
    plan: { mode: 'reading', clarification: null, includeAction: true, reuseExistingCards: false },
  };
}

describe.skipIf(!enabled)('intent snapshots with isolated PostgreSQL schema', () => {
  beforeAll(async () => {
    const original = config.getServerSetting;
    const connectionString = original('DATABASE_URL');
    admin = new pg.Client({
      connectionString,
      connectionTimeoutMillis: config.getServerNumber('DATABASE_CONNECT_TIMEOUT_MS'),
    });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    created = true;
    await admin.query(`SET search_path TO ${schema}`);
    await admin.query(await readFile('database/001_users_and_chat.sql', 'utf8'));
    const migration = await readFile('database/019_user_intents.sql', 'utf8');
    await admin.query(migration);
    await admin.query(migration);
    await admin.query(
      "INSERT INTO tarot_users (id, wechat_app_id, wechat_open_id, nickname) VALUES ($1, 'intent-test', 'a', 'A'), ($2, 'intent-test', 'b', 'B')",
      [userA, userB],
    );
    const scopedUrl = new URL(connectionString);
    scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
    vi.spyOn(config, 'getServerSetting').mockImplementation((key) =>
      key === 'DATABASE_URL' ? scopedUrl.toString() : original(key),
    );
    database();
    poolCreated = true;
  });

  afterAll(async () => {
    if (poolCreated) await database().end();
    if (created) {
      await admin.query('ROLLBACK');
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    }
    await admin?.end();
    vi.restoreAllMocks();
  });

  it('round-trips JSON and isolates users', async () => {
    const value = snapshot();
    await saveIntentSnapshot(userA, value);
    expect(await getIntentSnapshot(userA, value.id)).toEqual(value);
    await expect(getIntentSnapshot(userB, value.id)).rejects.toMatchObject({ status: 404 });
  });

  it('appends a revision without replacing the original', async () => {
    const original = snapshot();
    const next = snapshot(2);
    await saveIntentSnapshot(userA, original);
    await saveIntentSnapshot(userA, next, original.id);
    expect(await getIntentSnapshot(userA, original.id)).toEqual(original);
    const result = await database().query(
      'SELECT previous_id, revision FROM tarot_user_intents WHERE id=$1',
      [next.id],
    );
    expect(result.rows[0]).toEqual({ previous_id: original.id, revision: 2 });
    await expect(
      saveIntentSnapshot(userA, { ...original, question: 'overwrite' }),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects a cross-user previous snapshot at database level', async () => {
    const original = snapshot();
    await saveIntentSnapshot(userA, original);
    await expect(saveIntentSnapshot(userB, snapshot(2), original.id)).rejects.toMatchObject({
      code: '23503',
    });
  });
});
