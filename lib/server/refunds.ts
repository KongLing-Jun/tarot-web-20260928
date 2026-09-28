import { transaction } from './database';
import { HttpError } from './http';

/** Internal operations entry point. Only record refunds already confirmed in the provider back office. */
export async function recordCompletedRefund(input: {
  id: string;
  orderId: string;
  amountFen: number;
  refundedAt: string;
}) {
  if (
    typeof input.id !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(input.id) ||
    typeof input.orderId !== 'string' ||
    !/^[a-f0-9]{32}$/.test(input.orderId) ||
    !Number.isSafeInteger(input.amountFen) ||
    input.amountFen <= 0 ||
    typeof input.refundedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.refundedAt) ||
    !Number.isFinite(Date.parse(input.refundedAt)) ||
    Date.parse(input.refundedAt) > Date.now()
  ) {
    throw new HttpError(
      400,
      '退款记录参数无效，请提供退款流水号、订单号、金额（分）和带时区的退款完成时间',
    );
  }
  return transaction(async (client) => {
    // Lock the original order to serialize partial refunds and prevent over-recording.
    const order = (
      await client.query(
        'SELECT status, amount_fen FROM tarot_payment_orders WHERE id=$1 FOR UPDATE',
        [input.orderId],
      )
    ).rows[0];
    if (!order) throw new HttpError(404, '充值订单不存在');
    if (order.status !== 'paid') throw new HttpError(409, '仅可登记已支付订单的退款');
    const existing = (
      await client.query('SELECT * FROM tarot_refund_records WHERE id=$1', [input.id])
    ).rows[0];
    if (existing) {
      if (
        existing.order_id !== input.orderId ||
        existing.amount_fen !== input.amountFen ||
        existing.refunded_at.getTime() !== Date.parse(input.refundedAt)
      ) {
        throw new HttpError(409, '退款流水号已存在且内容不一致');
      }
      return { id: input.id, created: false };
    }
    const total = (
      await client.query(
        'SELECT COALESCE(sum(amount_fen),0) AS amount FROM tarot_refund_records WHERE order_id=$1',
        [input.orderId],
      )
    ).rows[0];
    if (Number(total.amount) + input.amountFen > order.amount_fen)
      throw new HttpError(409, '累计退款金额不能超过订单实付金额');
    await client.query(
      'INSERT INTO tarot_refund_records(id,order_id,amount_fen,refunded_at) VALUES ($1,$2,$3,$4)',
      [input.id, input.orderId, input.amountFen, input.refundedAt],
    );
    return { id: input.id, created: true };
  });
}
