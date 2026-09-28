// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database } from '@/lib/server/database';

const enabled = process.env.TAROT_DB_TEST === '1';

describe.skipIf(!enabled)('recharge plan migration', () => {
  const schema = `plans_test_${randomUUID().replaceAll('-', '')}`;
  let client: PoolClient | undefined;
  let migration: string;

  beforeAll(async () => {
    migration = (
      await Promise.all(
        [
          '012_recharge_plans.sql',
          '014_card_draw_plan_names.sql',
          '015_card_draw_offers.sql',
          '016_one_fen_card_plan.sql',
        ].map((file) => readFile(`database/${file}`, 'utf8')),
      )
    ).join('\n');
    client = await database().connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(migration);
  });

  afterAll(async () => {
    if (client) {
      try {
        await client.query('ROLLBACK');
        await client.query('RESET search_path');
        await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      } finally {
        client.release();
      }
    }
    await database().end();
  });

  it('seeds the four default plans in order with prices in fen', async () => {
    const result = await client!.query(
      'SELECT id,name,amount_fen,points,sort_order,is_active FROM tarot_plans ORDER BY sort_order',
    );
    expect(result.rows).toEqual([
      { id: 'plan_1', name: '1 次卡', amount_fen: 1, points: 1, sort_order: 0, is_active: true },
      {
        id: 'plan_100',
        name: '5 次卡',
        amount_fen: 1000,
        points: 5,
        sort_order: 1,
        is_active: true,
      },
      {
        id: 'plan_300',
        name: '月订阅',
        amount_fen: 2880,
        points: 20,
        sort_order: 2,
        is_active: true,
      },
      {
        id: 'plan_1000',
        name: '年订阅',
        amount_fen: 9800,
        points: 100,
        sort_order: 3,
        is_active: true,
      },
    ]);
  });

  it('does not duplicate plans or overwrite configured values when rerun', async () => {
    await client!.query(
      "UPDATE tarot_plans SET name='自定义套餐',amount_fen=1200,points=120,is_active=false WHERE id='plan_100'",
    );
    await client!.query(migration);
    expect((await client!.query('SELECT * FROM tarot_plans')).rowCount).toBe(4);
    expect(
      (
        await client!.query(
          "SELECT name,amount_fen,points,is_active FROM tarot_plans WHERE id='plan_100'",
        )
      ).rows[0],
    ).toEqual({ name: '自定义套餐', amount_fen: 1200, points: 120, is_active: false });
  });

  it('rejects invalid prices and credit amounts', async () => {
    for (const [amountFen, points] of [
      [0, 100],
      [-1, 100],
      [1000, 0],
      [1000, -1],
    ]) {
      await expect(
        client!.query(
          "INSERT INTO tarot_plans(id,name,amount_fen,points) VALUES ('invalid','invalid',$1,$2)",
          [amountFen, points],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    }
  });
});
