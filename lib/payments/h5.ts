export function h5PaymentUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error('未取得有效支付链接，请查询订单后重试');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('支付链接无效');
  }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('支付链接无效');
  return url.href;
}

export function openH5Payment(value: unknown) {
  window.location.assign(h5PaymentUrl(value));
}
