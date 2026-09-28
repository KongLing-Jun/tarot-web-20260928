// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { preparePayment } from '@/lib/server/payments';

const { query, gateway } = vi.hoisted(() => ({ query: vi.fn(), gateway: vi.fn() }));
vi.mock('@/lib/server/database', () => ({ database: () => ({ query }), transaction: vi.fn() }));
vi.mock('@/lib/server/huifu', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/huifu')>()),
  requirePaymentConfig: vi.fn(),
  huifuRequest: gateway,
}));

const order: Parameters<typeof preparePayment>[0] = {
  id: 'legacy-order',
  user_id: 'user',
  plan_id: 'plan',
  merchant_id: 'merchant',
  req_date: '20260921',
  amount_fen: 1000,
  points: 5,
  status: 'pending',
  hf_seq_id: null,
  request_data: { trade_type: 'T_MINIAPP' },
  pay_info: null,
  attempted_at: null,
  expires_at: new Date('2099-01-01'),
  created_at: new Date('2026-09-21'),
  failure_reason: null,
};

beforeEach(() => vi.clearAllMocks());

describe('retired native checkout', () => {
  it.each([null, { paySign: 'legacy-cached-signature' }])(
    'rejects native orders even with cached payment data: %j',
    async (pay_info) => {
      await expect(preparePayment({ ...order, pay_info })).rejects.toMatchObject({ status: 409 });
      expect(query).not.toHaveBeenCalled();
      expect(gateway).not.toHaveBeenCalled();
    },
  );

  it('preserves an existing hosted cashier link', async () => {
    const payment = { url: 'https://api.huifu.com/hostingh5/?jump_id=test' };
    const result = await preparePayment({
      ...order,
      request_data: { pre_order_type: '1' },
      pay_info: payment,
    });
    expect(result.payment).toEqual(payment);
    expect(query).not.toHaveBeenCalled();
    expect(gateway).not.toHaveBeenCalled();
  });
});
