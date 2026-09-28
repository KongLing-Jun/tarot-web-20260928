import { database } from '../lib/server/database';
import { HttpError } from '../lib/server/http';
import { recordCompletedRefund } from '../lib/server/refunds';

async function main() {
  const [id, orderId, amount, refundedAt, ...extra] = process.argv.slice(2);
  if (!id || !orderId || !amount || !refundedAt || extra.length || !/^\d+$/.test(amount)) {
    throw new Error(
      '用法：npx tsx scripts/record-refund.ts <后台退款流水号> <充值订单号> <金额（分）> <退款完成时间，如 2026-09-16T18:00:00+08:00>',
    );
  }
  const result = await recordCompletedRefund({
    id,
    orderId,
    amountFen: Number(amount),
    refundedAt,
  });
  console.log(
    result.created ? '已登记退款记录，用户刷新购买页即可查看。' : '该退款已登记，无需重复处理。',
  );
}

main()
  .catch((error) => {
    console.error(
      error instanceof HttpError || (error instanceof Error && error.message.startsWith('用法：'))
        ? error.message
        : '登记失败，请检查数据库配置及迁移。',
    );
    process.exitCode = 1;
  })
  .finally(() => database().end());
