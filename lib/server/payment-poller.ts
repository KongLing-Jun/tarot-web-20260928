import { getServerNumber } from '@/lib/api/server-config';
import { paymentSetting } from './huifu';
import { reconcilePayments } from './payments';

const globalPoller = globalThis as unknown as { tarotPaymentPoller?: boolean };

export function startPaymentPoller(): void {
  if (globalPoller.tarotPaymentPoller) return;
  globalPoller.tarotPaymentPoller = true;
  async function tick() {
    let interval = 30;
    try {
      if (paymentSetting('POLL_ENABLED') === 'true') {
        interval = Math.max(10, getServerNumber('PAYMENT_V3_POLL_INTERVAL_SECONDS'));
        await reconcilePayments();
      }
    } catch {
      console.error('[payments] 自动查单暂不可用，请检查数据库及支付配置');
    } finally {
      setTimeout(() => void tick(), interval * 1000).unref();
    }
  }
  // Keep startup fast; Node server must remain running for unattended reconciliation.
  setTimeout(() => void tick(), 5000).unref();
}
