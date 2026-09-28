import { randomBytes } from 'node:crypto';
import { database, transaction } from './database';
import { HttpError } from './http';
import {
  chinaTime,
  HuifuBusinessError,
  huifuRequest,
  h5PaymentParams,
  hostingPaymentParams,
  hostingProjectId,
  paymentFailureReason,
  requirePaymentConfig,
} from './huifu';

interface Plan {
  id: string;
  name: string;
  amountFen: number;
  points: number;
}

export async function rechargePlans(): Promise<Plan[]> {
  return (
    await database().query<Plan>(
      'SELECT id, name, amount_fen AS "amountFen", points FROM tarot_plans WHERE is_active ORDER BY sort_order, id',
    )
  ).rows;
}

interface Order {
  id: string;
  user_id: string;
  plan_id: string | null;
  merchant_id: string;
  req_date: string;
  amount_fen: number;
  points: number;
  status: 'pending' | 'paid' | 'failed';
  hf_seq_id: string | null;
  request_data: Record<string, unknown>;
  pay_info: Record<string, string> | null;
  attempted_at: Date | null;
  expires_at: Date;
  created_at: Date;
  failure_reason: string | null;
}

export function publicOrder(order: Order) {
  return {
    id: order.id,
    planId: order.plan_id,
    amountFen: order.amount_fen,
    points: order.points,
    status: order.status,
    failureReason: order.status === 'failed' ? order.failure_reason : null,
    expired: order.expires_at.getTime() <= Date.now(),
    createdAt: order.created_at.toISOString(),
    expiresAt: order.expires_at.toISOString(),
  };
}

export async function wallet(userId: string) {
  const [balance, orders, plans, refunds] = await Promise.all([
    database().query('SELECT balance FROM tarot_user_credits WHERE user_id = $1', [userId]),
    database().query<Order>(
      'SELECT * FROM tarot_payment_orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10',
      [userId],
    ),
    rechargePlans(),
    database().query<{ id: string; orderId: string; amountFen: number; refundedAt: Date }>(
      `SELECT r.id, r.order_id AS "orderId", r.amount_fen AS "amountFen", r.refunded_at AS "refundedAt"
       FROM tarot_refund_records r JOIN tarot_payment_orders o ON o.id=r.order_id
       WHERE o.user_id=$1 ORDER BY r.refunded_at DESC, r.id LIMIT 10`,
      [userId],
    ),
  ]);
  return {
    balance: Number(balance.rows[0]?.balance ?? 0),
    orders: orders.rows.map(publicOrder),
    plans,
    refunds: refunds.rows.map((refund) => ({
      ...refund,
      status: 'succeeded' as const,
      refundedAt: refund.refundedAt.toISOString(),
    })),
  };
}

export async function createRecharge(
  userId: string,
  planId: unknown,
  hosting: { returnUrl: string },
) {
  if (typeof planId !== 'string' || !planId.trim() || planId.length > 100)
    throw new HttpError(400, '请选择充值方案');
  const config = requirePaymentConfig();
  const projectId = hostingProjectId();
  return transaction(async (client) => {
    // Serialize creation per user so duplicate clicks cannot create two payable orders.
    const identity = (
      await client.query('SELECT id FROM tarot_users WHERE id = $1 FOR UPDATE', [userId])
    ).rows[0];
    if (!identity) throw new HttpError(401, '请重新登录');
    const plan = (
      await client.query<Plan>(
        'SELECT id, name, amount_fen AS "amountFen", points FROM tarot_plans WHERE id = $1 AND is_active FOR SHARE',
        [planId],
      )
    ).rows[0];
    if (!plan) throw new HttpError(400, '充值方案已下架或不存在，请刷新后选择');
    const existing = await client.query<Order>(
      "SELECT * FROM tarot_payment_orders WHERE user_id = $1 AND status = 'pending' AND expires_at > now() AND amount_fen = $2 AND points = $3 AND merchant_id = $4 AND plan_id = $5 AND request_data->>'pre_order_type' = '1' ORDER BY created_at DESC LIMIT 1",
      [userId, plan.amountFen, plan.points, config.merchant, plan.id],
    );
    let order = existing.rows[0];
    if (!order) {
      const now = new Date();
      const id = randomBytes(16).toString('hex');
      const expires = new Date(now.getTime() + config.ttl * 1000);
      const reqDate = chinaTime(now).slice(0, 8);
      const checkout = {
        pre_order_type: '1',
        trans_type: 'T_JSAPI',
        multi_pay_way_flag: 'N',
        hosting_data: JSON.stringify({
          project_id: projectId,
          project_title: '月映卡语抽卡次数',
          request_type: 'M',
          callback_url: hosting.returnUrl,
        }),
      };
      const data = {
        req_seq_id: id,
        req_date: reqDate,
        huifu_id: config.merchant,
        trans_amt: (plan.amountFen / 100).toFixed(2),
        goods_desc: `月映卡语购买${plan.points}次抽卡`,
        time_expire: chinaTime(expires),
        ...checkout,
        ...(config.notify ? { notify_url: config.notify } : {}),
      };
      order = (
        await client.query<Order>(
          'INSERT INTO tarot_payment_orders (id, user_id, merchant_id, req_date, amount_fen, points, request_data, expires_at, plan_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
          [
            id,
            userId,
            config.merchant,
            reqDate,
            plan.amountFen,
            plan.points,
            JSON.stringify(data),
            expires,
            plan.id,
          ],
        )
      ).rows[0];
    }
    return { order: publicOrder(order) };
  });
}

export async function ownedOrder(id: string, userId: string): Promise<Order> {
  const result = await database().query<Order>(
    'SELECT * FROM tarot_payment_orders WHERE id = $1 AND user_id = $2',
    [id, userId],
  );
  if (!result.rows[0]) throw new HttpError(404, '充值订单不存在');
  return result.rows[0];
}

export async function applyPaymentResult(
  data: Record<string, unknown>,
  source: 'query' | 'notify',
) {
  const id = data[source === 'query' ? 'org_req_seq_id' : 'req_seq_id'];
  const date = data[source === 'query' ? 'org_req_date' : 'req_date'];
  const hf = data[source === 'query' ? 'org_hf_seq_id' : 'hf_seq_id'];
  if (typeof id !== 'string') throw new HttpError(400, '支付流水号缺失');
  return transaction(async (client) => {
    const order = (
      await client.query<Order>('SELECT * FROM tarot_payment_orders WHERE id = $1 FOR UPDATE', [id])
    ).rows[0];
    if (!order) throw new HttpError(404, '充值订单不存在');
    const tradeType = order.request_data.trans_type ?? order.request_data.trade_type;
    if (
      data.huifu_id !== order.merchant_id ||
      date !== order.req_date ||
      data.trans_amt !== (order.amount_fen / 100).toFixed(2) ||
      [data.trans_type, data.trade_type, data.pay_type].some((type) => type && type !== tradeType)
    )
      throw new HttpError(400, '支付订单信息不匹配');
    if (
      order.pay_info?.preOrderId &&
      data.pre_order_id &&
      data.pre_order_id !== order.pay_info.preOrderId
    )
      throw new HttpError(400, '预下单订单号不匹配');
    if (!['S', 'F', 'P', 'I'].includes(String(data.trans_stat)))
      throw new HttpError(400, '支付状态无效');
    if (order.hf_seq_id && hf !== order.hf_seq_id) throw new HttpError(400, '支付流水号不匹配');
    if (data.trans_stat === 'S') {
      if (typeof hf !== 'string' || !hf || data.resp_code !== '00000000')
        throw new HttpError(400, '支付成功凭证不完整');
      // Ledger uniqueness and row lock make notify/query races credit exactly once.
      await client.query(
        'INSERT INTO tarot_credit_ledger (order_id,user_id,points) VALUES ($1,$2,$3) ON CONFLICT (order_id) DO NOTHING',
        [id, order.user_id, order.points],
      );
      await client.query(
        "UPDATE tarot_payment_orders SET status='paid', hf_seq_id=$2, paid_at=COALESCE(paid_at,now()) WHERE id=$1",
        [id, hf],
      );
    } else if (data.trans_stat === 'F' && order.status !== 'paid') {
      await client.query(
        "UPDATE tarot_payment_orders SET status='failed', failure_reason=$2, hf_seq_id=COALESCE(hf_seq_id,$3) WHERE id=$1",
        [id, paymentFailureReason(data), typeof hf === 'string' && hf ? hf : null],
      );
    }
    return id;
  });
}

export async function queryRecharge(order: Order) {
  // Expiry only disables further checkout; delayed success still credits the order.
  if (order.status !== 'paid' && order.attempted_at) {
    const hosting = order.request_data.pre_order_type === '1';
    const data = await huifuRequest(hosting ? 'HOSTING_QUERY' : 'QUERY_URL', {
      huifu_id: order.merchant_id,
      org_req_date: order.req_date,
      org_req_seq_id: order.id,
      ...(hosting
        ? {
            req_date: chinaTime(new Date()).slice(0, 8),
            req_seq_id: randomBytes(16).toString('hex'),
          }
        : {}),
    });
    if (data.org_req_seq_id !== order.id) throw new HttpError(502, '查询返回了不匹配的订单');
    // A hosted preorder can exist before a channel transaction is created.
    const result =
      hosting && !data.trans_stat && ['2', '4'].includes(String(data.order_stat))
        ? { ...data, trans_stat: 'P' }
        : data;
    await applyPaymentResult(result, 'query');
  }
  return publicOrder(await ownedOrder(order.id, order.user_id));
}

export async function preparePayment(order: Order) {
  requirePaymentConfig();
  const hosting = order.request_data.pre_order_type === '1';
  if (!hosting && order.request_data.trade_type !== 'T_H5')
    throw new HttpError(409, '此订单已不支持继续付款，请查询支付结果');
  if (order.status === 'failed')
    throw new HttpError(409, order.failure_reason || '支付未完成，请返回重新创建订单');
  if (order.status !== 'pending' || order.expires_at.getTime() <= Date.now())
    throw new HttpError(409, '订单已结束或已过期，请先查询支付结果');
  if (order.pay_info) return { order: publicOrder(order), payment: order.pay_info };
  if (order.attempted_at) {
    try {
      const current = await queryRecharge(order);
      if (current.status !== 'pending') return { order: current };
      throw new HttpError(409, '订单已提交，正在等待支付结果，请稍后查询');
    } catch (error) {
      // Resubmit identical parameters only when the signed query says no order exists.
      if (hosting || !(error instanceof HuifuBusinessError) || error.code !== '23000001')
        throw error;
    }
  }
  const claim = await database().query(
    "UPDATE tarot_payment_orders SET lease_until=now()+interval '30 seconds', attempted_at=COALESCE(attempted_at,now()) WHERE id=$1 AND status='pending' AND expires_at>now() AND (lease_until IS NULL OR lease_until<now()) RETURNING id",
    [order.id],
  );
  if (!claim.rowCount) throw new HttpError(409, '订单正在处理，请稍后查询');
  try {
    // Persisted original parameters keep retries idempotent after a network timeout.
    let data: Record<string, unknown>;
    try {
      data = await huifuRequest(hosting ? 'HOSTING_PREORDER' : 'GATEWAY_URL', order.request_data);
    } catch (error) {
      if (error instanceof HuifuBusinessError) {
        try {
          const current = await queryRecharge(await ownedOrder(order.id, order.user_id));
          if (current.status !== 'pending') return { order: current };
        } catch {
          /* Preserve the original verified business error if query is unavailable. */
        }
      }
      throw error;
    }
    if (
      data.req_seq_id !== order.id ||
      data.req_date !== order.req_date ||
      data.huifu_id !== order.merchant_id ||
      ((!hosting || data.trans_amt !== undefined) &&
        data.trans_amt !== (order.amount_fen / 100).toFixed(2))
    )
      throw new HttpError(502, '支付响应订单不匹配');
    if (hosting) {
      // Preorder success only creates a cashier link, not a paid transaction or hf_seq_id.
      const payment = hostingPaymentParams(data);
      await database().query('UPDATE tarot_payment_orders SET pay_info=$2 WHERE id=$1', [
        order.id,
        JSON.stringify(payment),
      ]);
      return { order: publicOrder(order), payment };
    }
    const payment = h5PaymentParams(data.pay_info);
    if (typeof data.hf_seq_id !== 'string' || !data.hf_seq_id)
      throw new HttpError(502, '支付响应缺少流水号');
    const saved = await database().query(
      'UPDATE tarot_payment_orders SET pay_info=$2, hf_seq_id=COALESCE(hf_seq_id,$3) WHERE id=$1 AND (hf_seq_id IS NULL OR hf_seq_id=$3)',
      [order.id, JSON.stringify(payment), data.hf_seq_id],
    );
    if (!saved.rowCount) throw new HttpError(502, '支付流水号不匹配，请查询订单');
    return { order: publicOrder(order), payment };
  } finally {
    await database().query('UPDATE tarot_payment_orders SET lease_until=NULL WHERE id=$1', [
      order.id,
    ]);
  }
}

export async function reconcilePayments(
  userId?: string,
): Promise<{ checked: number; failed: number }> {
  const result = { checked: 0, failed: 0 };
  // Claims survive process restarts, spread work across instances, and eventually expire.
  const due = await database().query<Order>(
    `UPDATE tarot_payment_orders SET next_query_at = now() + interval '5 minutes'
    WHERE id IN (SELECT id FROM tarot_payment_orders WHERE status='pending' AND attempted_at IS NOT NULL
      AND next_query_at <= now() AND (lease_until IS NULL OR lease_until < now())
      AND ($1::uuid IS NULL OR user_id=$1)
      ORDER BY next_query_at LIMIT 10 FOR UPDATE SKIP LOCKED) RETURNING *`,
    [userId ?? null],
  );
  for (const order of due.rows) {
    try {
      await queryRecharge(order);
      result.checked++;
    } catch {
      result.failed++;
      // Only order IDs are logged; never payloads, identities or credentials.
      console.error('[payments] 查单失败，稍后重试', order.id);
    } finally {
      await database().query(
        `UPDATE tarot_payment_orders SET next_query_at=now()+
        CASE WHEN expires_at < now()-interval '1 day' THEN interval '1 hour'
             WHEN expires_at < now() THEN interval '5 minutes' ELSE interval '30 seconds' END WHERE id=$1`,
        [order.id],
      );
    }
  }
  return result;
}
