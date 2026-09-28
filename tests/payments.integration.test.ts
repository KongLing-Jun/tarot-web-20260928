// @vitest-environment node
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import * as config from '@/lib/api/server-config';
import * as huifu from '@/lib/server/huifu';
import { database } from '@/lib/server/database';
import {
  applyPaymentResult,
  createRecharge,
  ownedOrder,
  preparePayment,
  queryRecharge,
  reconcilePayments,
  wallet,
} from '@/lib/server/payments';
import { POST as notify } from '@/app/api/payments/notify/route';
import { POST as queryRoute } from '@/app/api/payments/[id]/query/route';
import { GET as plansRoute, POST as purchaseRoute } from '@/app/api/payments/route';
import { hashToken, SESSION_COOKIE } from '@/lib/server/auth';
import { recordCompletedRefund } from '@/lib/server/refunds';

const enabled = process.env.TAROT_DB_TEST === '1';
const userA = randomUUID(),
  userB = randomUUID(),
  appId = `payment-test-${randomUUID()}`;
const planId = `${appId}-100`,
  secondPlanId = `${appId}-300`,
  thirdPlanId = `${appId}-1000`,
  disabledPlanId = `${appId}-disabled`;
const key = generateKeyPairSync('rsa', { modulusLength: 2048 });
const token = 'd'.repeat(64);
let pending: Awaited<ReturnType<typeof createRecharge>>;

describe.skipIf(!enabled)('payment ledger and authenticated routes', () => {
  beforeAll(async () => {
    const original = config.getServerSetting;
    vi.spyOn(config, 'getServerSetting').mockImplementation((name) => {
      const values: Record<string, string> = {
        PAYMENT_V3_ENABLED: 'true',
        PAYMENT_V3_HOSTING_PROJECT_ID: 'PROJECTID_TEST',
        PAYMENT_V3_SYS_ID: 'test',
        PAYMENT_V3_PRODUCT_ID: 'PAYUN',
        PAYMENT_V3_HUIFU_ID: 'test-merchant',
        PAYMENT_V3_MERCHANT_PRIVATE_KEY: 'only-mocked-gateway',
        PAYMENT_V3_HUIFU_PUBLIC_KEY: key.publicKey
          .export({ type: 'spki', format: 'der' })
          .toString('base64'),
        PAYMENT_V3_GATEWAY_URL: 'https://api.huifu.com/v3/trade/payment/jspay',
        PAYMENT_V3_QUERY_URL: 'https://api.huifu.com/v3/trade/payment/scanpay/query',
        PAYMENT_V3_NOTIFY_URL: '',
        PAYMENT_V3_ORDER_TTL: '10m',
      };
      return name in values ? values[name] : original(name);
    });
    await database().query(
      "INSERT INTO tarot_users(id,wechat_app_id,wechat_open_id,nickname) VALUES ($1,$3,'payer-a','test'),($2,$3,'payer-b','test')",
      [userA, userB, appId],
    );
    await database().query(
      "INSERT INTO tarot_sessions(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '1 hour')",
      [hashToken(token), userB],
    );
    await database().query(
      "INSERT INTO tarot_plans(id,name,amount_fen,points,sort_order,is_active) VALUES ($1,'test 100',1000,100,1001,true),($2,'test 300',2000,300,1002,true),($3,'test 1000',5000,1000,1003,true),($4,'disabled',100,1,1004,false)",
      [planId, secondPlanId, thirdPlanId, disabledPlanId],
    );
  });
  beforeEach(async () => {
    // Any unmocked network attempt fails instead of reaching a real payment gateway.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('No live network in payment tests');
      }),
    );
    await database().query('DELETE FROM tarot_payment_orders WHERE user_id IN ($1,$2)', [
      userA,
      userB,
    ]);
    await database().query('DELETE FROM tarot_user_credits WHERE user_id IN ($1,$2)', [
      userA,
      userB,
    ]);
    pending = await createRecharge(userA, planId, { returnUrl: 'https://example.com/profile' });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(huifu.huifuRequest).mockRestore?.();
  });
  afterAll(async () => {
    await database().query('DELETE FROM tarot_users WHERE id IN ($1,$2)', [userA, userB]);
    await database().query('DELETE FROM tarot_plans WHERE id = ANY($1::text[])', [
      [planId, secondPlanId, thirdPlanId, disabledPlanId],
    ]);
    await database().end();
    vi.restoreAllMocks();
  });

  async function success() {
    const order = await ownedOrder(pending.order.id, userA);
    return {
      resp_code: '00000000',
      huifu_id: 'test-merchant',
      req_seq_id: order.id,
      req_date: order.req_date,
      trans_amt: '10.00',
      trans_stat: 'S',
      hf_seq_id: `hf-${order.id}`,
      trans_type: 'T_JSAPI',
    };
  }

  function purchase(body: object) {
    return purchaseRoute(
      new NextRequest('http://localhost/api/payments', {
        method: 'POST',
        headers: {
          Cookie: `${SESSION_COOKIE}=${token}`,
          'x-forwarded-for': '203.0.113.10',
          origin: 'http://localhost',
        },
        body: JSON.stringify(body),
      }),
    );
  }

  it('returns active plans in order with the wallet and requires login', async () => {
    const response = await plansRoute(
      new NextRequest('http://localhost/api/payments', {
        headers: { Cookie: `${SESSION_COOKIE}=${token}` },
      }),
    );
    const data = await response.json();
    expect(data.plans.filter((plan: { id: string }) => plan.id.startsWith(appId))).toEqual([
      { id: planId, name: 'test 100', amountFen: 1000, points: 100 },
      { id: secondPlanId, name: 'test 300', amountFen: 2000, points: 300 },
      { id: thirdPlanId, name: 'test 1000', amountFen: 5000, points: 1000 },
    ]);
    expect(data.balance).toBe(0);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await plansRoute(new NextRequest('http://localhost/api/payments'))).status).toBe(401);
    expect(
      (
        await purchaseRoute(
          new NextRequest('http://localhost/api/payments', {
            method: 'POST',
            body: JSON.stringify({ planId }),
          }),
        )
      ).status,
    ).toBe(401);
  });

  it('records partial refunds once, isolates accounts, and preserves the credit balance', async () => {
    await applyPaymentResult(await success(), 'notify');
    const refund = {
      id: `refund-${pending.order.id}`,
      orderId: pending.order.id,
      amountFen: 400,
      refundedAt: '2026-01-01T10:00:00+08:00',
    };
    const results = await Promise.all([
      recordCompletedRefund(refund),
      recordCompletedRefund(refund),
    ]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect((await wallet(userA)).refunds).toEqual([
      {
        id: refund.id,
        orderId: refund.orderId,
        amountFen: 400,
        status: 'succeeded',
        refundedAt: '2026-01-01T02:00:00.000Z',
      },
    ]);
    expect((await wallet(userB)).refunds).toEqual([]);
    const response = await plansRoute(
      new NextRequest('http://localhost/api/payments', {
        headers: { Cookie: `${SESSION_COOKIE}=${token}` },
      }),
    );
    expect((await response.json()).refunds).toEqual([]);
    await expect(recordCompletedRefund({ ...refund, amountFen: 500 })).rejects.toThrow(
      '内容不一致',
    );
    await expect(
      recordCompletedRefund({ ...refund, id: `${refund.id}-over`, amountFen: 601 }),
    ).rejects.toThrow('不能超过');
    await recordCompletedRefund({ ...refund, id: `${refund.id}-rest`, amountFen: 600 });
    await applyPaymentResult(await success(), 'notify');
    expect((await wallet(userA)).balance).toBe(100);
    expect((await wallet(userA)).refunds).toHaveLength(2);
  });

  it('rejects refunds for unpaid orders and serializes concurrent partial refunds', async () => {
    const refund = {
      id: `refund-${pending.order.id}`,
      orderId: pending.order.id,
      amountFen: 600,
      refundedAt: '2026-01-01T02:00:00Z',
    };
    await expect(recordCompletedRefund(refund)).rejects.toThrow('已支付');
    await applyPaymentResult(await success(), 'notify');
    const results = await Promise.allSettled([
      recordCompletedRefund(refund),
      recordCompletedRefund({ ...refund, id: `${refund.id}-other` }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await wallet(userA)).refunds).toHaveLength(1);
  });

  it('returns refunds from older orders independently of the ten most recent recharges', async () => {
    await applyPaymentResult(await success(), 'notify');
    const refund = {
      id: `refund-${pending.order.id}`,
      orderId: pending.order.id,
      amountFen: 1,
      refundedAt: '2026-01-01T02:00:00Z',
    };
    await recordCompletedRefund(refund);
    await database().query(
      "UPDATE tarot_payment_orders SET created_at=now()-interval '1 year' WHERE id=$1",
      [pending.order.id],
    );
    await database().query(
      `INSERT INTO tarot_payment_orders (id,user_id,merchant_id,req_date,amount_fen,points,request_data,expires_at)
      SELECT $2 || '-' || n, $1, 'test-merchant', '20260101', 1000, 100, '{}', now() FROM generate_series(1,10) n`,
      [userA, appId],
    );
    const result = await wallet(userA);
    expect(result.orders).toHaveLength(10);
    expect(result.orders.some((order) => order.id === pending.order.id)).toBe(false);
    expect(result.refunds[0].orderId).toBe(pending.order.id);
  });

  it.each([
    {},
    { planId: null },
    { planId: 'missing-plan' },
    { planId: disabledPlanId },
    { planId, amountFen: 1 },
    { planId, points: 99999 },
  ])('rejects invalid plans and client pricing: %j', async (body) => {
    expect((await purchase(body)).status).toBe(400);
    expect((await wallet(userB)).orders).toHaveLength(0);
  });

  it.each([
    ['5 次卡', 1000, 5],
    ['月订阅', 2880, 20],
    ['年订阅', 9800, 100],
  ])(
    'purchases %s and credits its snapshot once through background polling',
    async (name, amountFen, points) => {
      const id = `${appId}-offer-${points}`;
      try {
        await database().query(
          'INSERT INTO tarot_plans(id,name,amount_fen,points) VALUES ($1,$2,$3,$4)',
          [id, name, amountFen, points],
        );
        const gateway = vi
          .spyOn(huifu, 'huifuRequest')
          .mockImplementation(async (_endpoint, data) => ({
            req_seq_id: data.req_seq_id,
            req_date: data.req_date,
            huifu_id: data.huifu_id,
            resp_code: '00000000',
            pre_order_id: `H-${data.req_seq_id}`,
            jump_url: 'https://api.huifu.com/hostingh5/?jump_id=test',
          }));
        const response = await purchase({ planId: id });
        expect(response.status).toBe(200);
        const created = await response.json();
        expect(created.order).toMatchObject({ planId: id, amountFen, points });
        expect(created.url).toBe('https://api.huifu.com/hostingh5/?jump_id=test');
        expect(created).not.toHaveProperty('ticket');
        const order = await ownedOrder(created.order.id, userB);
        expect(order.request_data).toMatchObject({
          pre_order_type: '1',
          trans_type: 'T_JSAPI',
          multi_pay_way_flag: 'N',
        });
        expect(order.request_data).not.toHaveProperty('wx_data');
        expect(order.hf_seq_id).toBeNull();
        expect((await wallet(userB)).balance).toBe(0);
        expect(JSON.parse(String(order.request_data.hosting_data))).toEqual({
          project_id: 'PROJECTID_TEST',
          project_title: '月映卡语抽卡次数',
          request_type: 'M',
          callback_url: 'http://localhost/profile/credits',
        });
        expect((await purchase({ planId: id })).status).toBe(200);
        expect(gateway).toHaveBeenCalledTimes(1);
        expect(gateway.mock.calls[0][0]).toBe('HOSTING_PREORDER');
        expect(order.user_id).toBe(userB);
        expect(order.request_data.trans_amt).toBe((Number(amountFen) / 100).toFixed(2));
        const result = {
          resp_code: '00000000',
          huifu_id: 'test-merchant',
          org_req_seq_id: order.id,
          org_req_date: order.req_date,
          trans_amt: (Number(amountFen) / 100).toFixed(2),
          trans_stat: 'S',
          pay_type: 'T_JSAPI',
          org_hf_seq_id: `hf-${order.id}`,
        };
        gateway.mockResolvedValue(result);
        await database().query('UPDATE tarot_payment_orders SET attempted_at=now() WHERE id=$1', [
          order.id,
        ]);
        expect(await reconcilePayments(userB)).toEqual({ checked: 1, failed: 0 });
        expect(gateway.mock.calls[1]).toEqual([
          'HOSTING_QUERY',
          expect.objectContaining({
            org_req_seq_id: order.id,
            org_req_date: order.req_date,
            req_date: expect.stringMatching(/^\d{8}$/),
            req_seq_id: expect.any(String),
          }),
        ]);
        await applyPaymentResult(result, 'query');
        expect((await wallet(userB)).balance).toBe(points);
        expect((await ownedOrder(order.id, userB)).status).toBe('paid');
      } finally {
        await database().query('DELETE FROM tarot_plans WHERE id=$1', [id]);
      }
    },
  );

  it('does not reuse another plan order and keeps old snapshots after a plan is changed or disabled', async () => {
    const other = await createRecharge(userA, secondPlanId, {
      returnUrl: 'https://example.com/profile',
    });
    expect(other.order.id).not.toBe(pending.order.id);
    const customPlan = `${appId}-editable`;
    try {
      await database().query(
        "INSERT INTO tarot_plans(id,name,amount_fen,points) VALUES ($1,'editable',1000,100)",
        [customPlan],
      );
      const old = await createRecharge(userA, customPlan, {
        returnUrl: 'https://example.com/profile',
      });
      await database().query('UPDATE tarot_plans SET amount_fen=2000,points=300 WHERE id=$1', [
        customPlan,
      ]);
      const updated = await createRecharge(userA, customPlan, {
        returnUrl: 'https://example.com/profile',
      });
      expect(updated.order.id).not.toBe(old.order.id);
      expect(updated.order).toMatchObject({ amountFen: 2000, points: 300 });
      await database().query('UPDATE tarot_plans SET is_active=false WHERE id=$1', [customPlan]);
      await expect(
        createRecharge(userA, customPlan, { returnUrl: 'https://example.com/profile' }),
      ).rejects.toThrow('下架');
      const order = await ownedOrder(old.order.id, userA);
      expect(order).toMatchObject({ amount_fen: 1000, points: 100 });
      await applyPaymentResult(
        {
          resp_code: '00000000',
          huifu_id: 'test-merchant',
          req_seq_id: order.id,
          req_date: order.req_date,
          trans_amt: '10.00',
          trans_stat: 'S',
          hf_seq_id: `hf-${order.id}`,
        },
        'notify',
      );
      expect((await wallet(userA)).balance).toBe(100);
    } finally {
      await database().query('DELETE FROM tarot_plans WHERE id=$1', [customPlan]);
    }
  });

  it('keeps H5 and legacy miniapp orders separate and rejects settlement for the wrong channel', async () => {
    await database().query('UPDATE tarot_payment_orders SET request_data=$2 WHERE id=$1', [
      pending.order.id,
      JSON.stringify({ trade_type: 'T_MINIAPP' }),
    ]);
    const h5 = await createRecharge(userA, planId, {
      returnUrl: 'https://example.com/profile/credits',
    });
    expect(h5.order.id).not.toBe(pending.order.id);
    const order = await ownedOrder(h5.order.id, userA);
    const data = {
      ...(await success()),
      trans_type: 'T_MINIAPP',
      req_seq_id: order.id,
      req_date: order.req_date,
      hf_seq_id: `hf-${order.id}`,
    };
    await expect(applyPaymentResult(data, 'notify')).rejects.toThrow('信息不匹配');
    expect((await wallet(userA)).balance).toBe(0);
    await applyPaymentResult({ ...data, trans_type: 'T_JSAPI' }, 'notify');
    await applyPaymentResult({ ...data, trans_type: 'T_JSAPI' }, 'notify');
    expect((await wallet(userA)).balance).toBe(100);
  });

  it('leaves a hosted preorder pending before the channel transaction exists', async () => {
    const created = await createRecharge(userA, planId, {
      returnUrl: 'https://example.com/profile/credits',
    });
    const order = await ownedOrder(created.order.id, userA);
    await database().query('UPDATE tarot_payment_orders SET attempted_at=now() WHERE id=$1', [
      order.id,
    ]);
    const gateway = vi.spyOn(huifu, 'huifuRequest').mockResolvedValue({
      resp_code: '00000000',
      huifu_id: order.merchant_id,
      org_req_seq_id: order.id,
      org_req_date: order.req_date,
      trans_amt: '10.00',
      order_stat: '2',
    });
    expect((await queryRecharge(await ownedOrder(order.id, userA))).status).toBe('pending');
    expect((await wallet(userA)).balance).toBe(0);
    await expect(preparePayment(await ownedOrder(order.id, userA))).rejects.toThrow('订单已提交');
    gateway.mockRejectedValue(new huifu.HuifuBusinessError('23000001', {}));
    await expect(preparePayment(await ownedOrder(order.id, userA))).rejects.toThrow();
    expect(gateway.mock.calls.every(([endpoint]) => endpoint === 'HOSTING_QUERY')).toBe(true);
  });

  it('returns zero for users without a credit record without creating one', async () => {
    expect((await wallet(userA)).balance).toBe(0);
    expect((await wallet(userB)).balance).toBe(0);
    const rows = await database().query(
      'SELECT * FROM tarot_user_credits WHERE user_id IN ($1,$2)',
      [userA, userB],
    );
    expect(rows.rowCount).toBe(0);
  });
  it('backfills existing credits and preserves balances when the migration is rerun', async () => {
    const client = await database().connect();
    const schema = `credits_test_${randomUUID().replaceAll('-', '')}`;
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      for (const file of ['001_users_and_chat.sql', '008_credit_recharge.sql']) {
        await client.query(await readFile(`database/${file}`, 'utf8'));
      }
      await client.query(
        "INSERT INTO tarot_users(id,wechat_app_id,wechat_open_id,nickname) VALUES ($1,'test','a','test'),($2,'test','b','test')",
        [userA, userB],
      );
      await client.query(
        "INSERT INTO tarot_payment_orders(id,user_id,merchant_id,req_date,amount_fen,points,request_data,expires_at) VALUES ('old-1',$1,'test','20260916',100,3,'{}',now()),('old-2',$1,'test','20260916',100,4,'{}',now())",
        [userA],
      );
      await client.query(
        "INSERT INTO tarot_credit_ledger(order_id,user_id,points) VALUES ('old-1',$1,3),('old-2',$1,4)",
        [userA],
      );
      const migration = await readFile('database/011_user_credits.sql', 'utf8');
      await client.query(migration);
      expect((await client.query('SELECT user_id,balance FROM tarot_user_credits')).rows).toEqual([
        { user_id: userA, balance: '7' },
      ]);
      await client.query('UPDATE tarot_user_credits SET balance=2 WHERE user_id=$1', [userA]);
      await client.query(migration);
      expect(
        (await client.query('SELECT balance FROM tarot_user_credits WHERE user_id=$1', [userA]))
          .rows[0].balance,
      ).toBe('2');
      await client.query('INSERT INTO tarot_user_credits(user_id) VALUES ($1)', [userB]);
      expect(
        (await client.query('SELECT balance FROM tarot_user_credits WHERE user_id=$1', [userB]))
          .rows[0].balance,
      ).toBe('0');
      await client.query('DELETE FROM tarot_users WHERE id=$1', [userA]);
      expect(
        (await client.query('SELECT * FROM tarot_user_credits WHERE user_id=$1', [userA])).rowCount,
      ).toBe(0);
    } finally {
      await client.query('ROLLBACK');
      await client.query('RESET search_path');
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
    }
  });
  it('reads the stored balance independently of recharge history and isolates users', async () => {
    await database().query('INSERT INTO tarot_user_credits (user_id,balance) VALUES ($1,20)', [
      userA,
    ]);
    expect((await wallet(userA)).balance).toBe(20);
    expect((await wallet(userB)).balance).toBe(0);
    await applyPaymentResult(await success(), 'notify');
    expect((await wallet(userA)).balance).toBe(120);
    await expect(
      database().query('UPDATE tarot_user_credits SET balance=-1 WHERE user_id=$1', [userA]),
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('accumulates concurrent distinct payments without losing credits', async () => {
    const first = await success();
    await database().query(
      "UPDATE tarot_payment_orders SET expires_at=now()-interval '1 second' WHERE id=$1",
      [pending.order.id],
    );
    pending = await createRecharge(userA, planId, { returnUrl: 'https://example.com/profile' });
    const second = await success();
    await Promise.all([applyPaymentResult(first, 'notify'), applyPaymentResult(second, 'notify')]);
    expect((await wallet(userA)).balance).toBe(200);
  });
  it('rolls back ledger and balance together when settlement fails', async () => {
    const first = await success();
    await applyPaymentResult(first, 'notify');
    pending = await createRecharge(userA, planId, { returnUrl: 'https://example.com/profile' });
    await expect(
      applyPaymentResult({ ...(await success()), hf_seq_id: first.hf_seq_id }, 'notify'),
    ).rejects.toMatchObject({ code: '23505' });
    expect((await wallet(userA)).balance).toBe(100);
    const ledger = await database().query('SELECT * FROM tarot_credit_ledger WHERE order_id=$1', [
      pending.order.id,
    ]);
    expect(ledger.rowCount).toBe(0);
    expect((await ownedOrder(pending.order.id, userA)).status).toBe('pending');
  });

  it('deduplicates concurrent creation and binds the hosted price without payment tickets', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        createRecharge(userA, planId, { returnUrl: 'https://example.com/profile' }),
      ),
    );
    expect(new Set(results.map((value) => value.order.id)).size).toBe(1);
    const order = await ownedOrder(results[0].order.id, userA);
    expect(order.amount_fen).toBe(1000);
    expect(order.points).toBe(100);
    expect(order.request_data).toMatchObject({
      pre_order_type: '1',
      trans_type: 'T_JSAPI',
      trans_amt: '10.00',
    });
    expect(order.request_data).not.toHaveProperty('wx_data');
    expect(results.every((value) => !('ticket' in value))).toBe(true);
    expect(order.request_data).not.toHaveProperty('notify_url');
    expect(JSON.stringify(results)).not.toMatch(/openid|private_key/);
  });
  it('creates a new order after a price change and preserves the old order amount', async () => {
    await database().query(
      `UPDATE tarot_payment_orders SET amount_fen=1, request_data=jsonb_set(request_data,'{trans_amt}','"0.01"'::jsonb) WHERE id=$1`,
      [pending.order.id],
    );
    const updated = await createRecharge(userA, planId, {
      returnUrl: 'https://example.com/profile',
    });
    expect(updated.order.id).not.toBe(pending.order.id);
    expect(updated.order.amountFen).toBe(1000);
    expect((await ownedOrder(pending.order.id, userA)).request_data.trans_amt).toBe('0.01');
    await applyPaymentResult({ ...(await success()), trans_amt: '0.01' }, 'notify');
    expect((await wallet(userA)).balance).toBe(100);
  });
  it('rejects another user reading an order', async () => {
    await expect(ownedOrder(pending.order.id, userB)).rejects.toThrow('不存在');
    const response = await queryRoute(
      new NextRequest('http://localhost/api/payments/test/query', {
        method: 'POST',
        headers: { Cookie: `${SESSION_COOKIE}=${token}` },
      }),
      { params: Promise.resolve({ id: pending.order.id }) },
    );
    expect(response.status).toBe(404);
  });
  it.each([
    { trans_amt: '0.02' },
    { huifu_id: 'other' },
    { req_date: '19990101' },
    { trans_type: 'A_JSAPI' },
    { hf_seq_id: '' },
    { resp_code: '00000100' },
  ])('rejects mismatched settlement %j', async (change) => {
    await expect(
      applyPaymentResult({ ...(await success()), ...change }, 'notify'),
    ).rejects.toThrow();
    expect((await wallet(userA)).balance).toBe(0);
  });
  it('credits once under concurrent notifications and queries and never regresses paid status', async () => {
    const data = await success();
    const query = {
      ...data,
      org_req_seq_id: data.req_seq_id,
      org_req_date: data.req_date,
      org_hf_seq_id: data.hf_seq_id,
    };
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        applyPaymentResult(index % 2 ? data : query, index % 2 ? 'notify' : 'query'),
      ),
    );
    expect((await wallet(userA)).balance).toBe(100);
    await applyPaymentResult({ ...data, trans_stat: 'F' }, 'notify');
    expect((await ownedOrder(pending.order.id, userA)).status).toBe('paid');
    expect((await wallet(userB)).balance).toBe(0);
  });
  it('verifies a form notification before updating the ledger and acknowledges replays', async () => {
    const raw = JSON.stringify(await success());
    const signature = sign('RSA-SHA256', Buffer.from(raw), key.privateKey).toString('base64');
    const request = (resp_data: string) =>
      new Request('http://localhost/api/payments/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ resp_data, sign: signature }).toString(),
      });
    expect((await notify(request(raw.replace('10.00', '0.02')))).status).toBe(400);
    expect((await wallet(userA)).balance).toBe(0);
    expect(await (await notify(request(raw))).text()).toBe(`RECV_ORD_ID_${pending.order.id}`);
    expect((await notify(request(raw))).status).toBe(200);
    expect((await wallet(userA)).balance).toBe(100);
  });
  it('does not award points for a pending gateway response', async () => {
    await applyPaymentResult(
      { ...(await success()), trans_stat: 'P', resp_code: '00000100' },
      'notify',
    );
    expect((await wallet(userA)).balance).toBe(0);
  });
  it('reuses identical gateway arguments after an ambiguous timeout and stores no credit on prepay', async () => {
    const original = await ownedOrder(pending.order.id, userA);
    const { pre_order_type, trans_type, hosting_data, multi_pay_way_flag, ...data } =
      original.request_data;
    void pre_order_type;
    void trans_type;
    void hosting_data;
    void multi_pay_way_flag;
    await database().query('UPDATE tarot_payment_orders SET request_data=$2 WHERE id=$1', [
      pending.order.id,
      JSON.stringify({ ...data, trade_type: 'T_H5' }),
    ]);
    const order = await ownedOrder(pending.order.id, userA);
    const payment = { mweb_url: 'https://wx.tenpay.com/pay/test' };
    const gateway = vi
      .spyOn(huifu, 'huifuRequest')
      .mockRejectedValueOnce(new Error('Timeout'))
      .mockRejectedValueOnce(new huifu.HuifuBusinessError('23000001', {}))
      .mockResolvedValueOnce({
        ...(await success()),
        trans_type: 'T_H5',
        trans_stat: 'P',
        resp_code: '00000100',
        pay_info: JSON.stringify(payment),
      });
    await expect(preparePayment(order)).rejects.toThrow('Timeout');
    await preparePayment(await ownedOrder(order.id, userA));
    expect(gateway.mock.calls[1][0]).toBe('QUERY_URL');
    expect(gateway.mock.calls[0]).toEqual(gateway.mock.calls[2]);
    expect((await wallet(userA)).balance).toBe(0);
  });
  it('recovers a paid order after local expiry through the background query worker', async () => {
    const data = await success();
    vi.spyOn(huifu, 'huifuRequest').mockResolvedValue({
      ...data,
      org_req_seq_id: data.req_seq_id,
      org_req_date: data.req_date,
      org_hf_seq_id: data.hf_seq_id,
    });
    await database().query(
      "UPDATE tarot_payment_orders SET attempted_at=now(), expires_at=now()-interval '1 hour' WHERE id=$1",
      [pending.order.id],
    );
    await reconcilePayments(userA);
    expect((await wallet(userA)).balance).toBe(100);
  });
  it('resolves duplicate submission to the original channel failure without opening checkout', async () => {
    const data = await success();
    const gateway = vi
      .spyOn(huifu, 'huifuRequest')
      .mockRejectedValueOnce(new huifu.HuifuBusinessError('20000000', {}))
      .mockResolvedValueOnce({
        ...data,
        trans_stat: 'F',
        bank_desc: 'sub_mch_id与sub_appid不匹配',
        org_req_seq_id: data.req_seq_id,
        org_req_date: data.req_date,
        org_hf_seq_id: data.hf_seq_id,
      });
    const result = await preparePayment(await ownedOrder(pending.order.id, userA));
    expect(result).not.toHaveProperty('payment');
    expect(result.order.status).toBe('failed');
    expect(result.order.failureReason).toContain('AppID 绑定');
    expect(gateway.mock.calls.map(([endpoint]) => endpoint)).toEqual([
      'HOSTING_PREORDER',
      'HOSTING_QUERY',
    ]);
    expect((await wallet(userA)).balance).toBe(0);
    await expect(preparePayment(await ownedOrder(pending.order.id, userA))).rejects.toThrow(
      'AppID 绑定',
    );
    expect(gateway).toHaveBeenCalledTimes(2);
  });
  it('queries an attempted order before retrying and does not resubmit a known pending order', async () => {
    const data = await success();
    await database().query('UPDATE tarot_payment_orders SET attempted_at=now() WHERE id=$1', [
      pending.order.id,
    ]);
    const gateway = vi.spyOn(huifu, 'huifuRequest').mockResolvedValue({
      ...data,
      trans_stat: 'P',
      org_req_seq_id: data.req_seq_id,
      org_req_date: data.req_date,
      org_hf_seq_id: data.hf_seq_id,
    });
    await expect(preparePayment(await ownedOrder(pending.order.id, userA))).rejects.toThrow(
      '订单已提交',
    );
    expect(gateway.mock.calls.map(([endpoint]) => endpoint)).toEqual(['HOSTING_QUERY']);
  });
  it('does not mark a timed-out query failed or lose its future reconciliation', async () => {
    vi.spyOn(huifu, 'huifuRequest').mockRejectedValue(new Error('Timeout'));
    await database().query('UPDATE tarot_payment_orders SET attempted_at=now() WHERE id=$1', [
      pending.order.id,
    ]);
    await expect(queryRecharge(await ownedOrder(pending.order.id, userA))).rejects.toThrow(
      'Timeout',
    );
    expect((await ownedOrder(pending.order.id, userA)).status).toBe('pending');
  });
});
