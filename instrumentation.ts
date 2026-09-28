export async function register() {
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.NEXT_PHASE !== 'phase-production-build'
  ) {
    const { startPaymentPoller } = await import('./lib/server/payment-poller');
    startPaymentPoller();
  }
}
