import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { getServerSetting } from '@/lib/api/server-config';
import { HttpError } from './http';
import { h5PaymentUrl } from '@/lib/payments/h5';

type Data = Record<string, unknown>;

export function paymentFailureReason(data: Data): string {
  const description = [data.bank_desc, data.resp_desc]
    .filter((value) => typeof value === 'string')
    .join(' ');
  if (/sub_mch_id.*sub_appid.*不匹配/i.test(description))
    return '商户尚未正确关联当前小程序，请在斗拱后台检查小程序 AppID 绑定后重试';
  return '支付未完成，请返回重新创建订单';
}

export class HuifuBusinessError extends HttpError {
  constructor(
    public readonly code: string,
    data: Data,
  ) {
    const reason = paymentFailureReason(data);
    super(
      502,
      reason.startsWith('商户')
        ? reason
        : code === '20000000'
          ? '订单已提交，请查询支付结果，勿重复提交'
          : `斗拱暂未受理该请求（${code}），请查询订单或联系管理员`,
    );
  }
}

export function paymentSetting(name: string): string {
  return getServerSetting(`PAYMENT_V3_${name}`);
}

export function paymentEnabled(): boolean {
  return paymentSetting('ENABLED') === 'true';
}

export function requirePaymentConfig() {
  if (!paymentEnabled()) throw new HttpError(503, '抽卡次数购买暂未开放');
  for (const key of [
    'SYS_ID',
    'PRODUCT_ID',
    'HUIFU_ID',
    'MERCHANT_PRIVATE_KEY',
    'HUIFU_PUBLIC_KEY',
    'GATEWAY_URL',
    'QUERY_URL',
  ]) {
    if (!paymentSetting(key)) throw new HttpError(503, '支付配置尚未完成');
  }
  const notify = paymentSetting('NOTIFY_URL');
  if (
    notify &&
    (!/^https:\/\//.test(notify) || new URL(notify).username || new URL(notify).password)
  )
    throw new HttpError(503, '支付通知地址必须是 HTTPS 地址');
  return { merchant: paymentSetting('HUIFU_ID'), notify, ttl: orderTtl() };
}

export function orderTtl(): number {
  const match = /^(\d+)(m|s)$/.exec(paymentSetting('ORDER_TTL') || '10m');
  const seconds = match ? Number(match[1]) * (match[2] === 'm' ? 60 : 1) : 0;
  if (seconds < 60 || seconds > 7200) throw new HttpError(503, '支付订单有效期配置无效');
  return seconds;
}

export function chinaTime(date: Date): string {
  return new Date(date.getTime() + 8 * 3600_000).toISOString().slice(0, 19).replace(/[-T:]/g, '');
}

export function sortedJson(data: Data): string {
  // JSON-valued strings (wx_data, pay_info) must remain byte-for-byte unchanged.
  return JSON.stringify(
    Object.fromEntries(
      Object.keys(data)
        .sort()
        .map((key) => [key, data[key]]),
    ),
  );
}

function keyObject(value: string, privateKey = false) {
  if (value.includes('-----BEGIN'))
    return privateKey
      ? createPrivateKey(value.replace(/\\n/g, '\n'))
      : createPublicKey(value.replace(/\\n/g, '\n'));
  const options = { key: Buffer.from(value, 'base64'), format: 'der' as const };
  return privateKey
    ? createPrivateKey({ ...options, type: 'pkcs8' })
    : createPublicKey({ ...options, type: 'spki' });
}

function verified(data: string, signature: unknown): boolean {
  try {
    return (
      typeof signature === 'string' &&
      verify(
        'RSA-SHA256',
        Buffer.from(data),
        keyObject(paymentSetting('HUIFU_PUBLIC_KEY')),
        Buffer.from(signature, 'base64'),
      )
    );
  } catch {
    return false;
  }
}

function object(value: unknown): Data {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new HttpError(502, '支付响应格式无效');
  return value as Data;
}

export function verifyNotification(envelope: Data): Data {
  if (typeof envelope.resp_data !== 'string' || !verified(envelope.resp_data, envelope.sign))
    throw new HttpError(400, '支付通知验签失败');
  try {
    return object(JSON.parse(envelope.resp_data));
  } catch {
    throw new HttpError(400, '支付通知格式错误');
  }
}

export async function huifuRequest(
  endpoint: 'GATEWAY_URL' | 'QUERY_URL' | 'HOSTING_PREORDER' | 'HOSTING_QUERY',
  data: Data,
): Promise<Data> {
  const hostingPaths = {
    HOSTING_PREORDER: '/v2/trade/hosting/payment/preorder',
    HOSTING_QUERY: '/v2/trade/hosting/payment/queryorderinfo',
  };
  const hostingPath =
    endpoint === 'HOSTING_PREORDER' || endpoint === 'HOSTING_QUERY' ? hostingPaths[endpoint] : null;
  const url = new URL(
    hostingPath ? `https://api.huifu.com${hostingPath}` : paymentSetting(endpoint),
  );
  if (
    url.origin !== 'https://api.huifu.com' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new HttpError(503, '支付网关配置无效');
  const expected =
    hostingPath ??
    (endpoint === 'GATEWAY_URL' ? '/v3/trade/payment/jspay' : '/v3/trade/payment/scanpay/query');
  if (url.pathname !== expected) throw new HttpError(503, '支付接口配置无效');
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(sortedJson(data)),
    keyObject(paymentSetting('MERCHANT_PRIVATE_KEY'), true),
  ).toString('base64');
  let envelope: Data;
  try {
    const response = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sys_id: paymentSetting('SYS_ID'),
        product_id: paymentSetting('PRODUCT_ID'),
        data,
        sign: signature,
      }),
    });
    if (!response.ok) throw new Error();
    envelope = object(await response.json());
  } catch {
    throw new HttpError(502, '支付服务暂未响应，请查询订单后重试');
  }
  const result = object(envelope.data);
  if (!verified(sortedJson(result), envelope.sign))
    throw new HttpError(502, '支付响应验签失败，请稍后查询订单');
  if (!['00000000', '00000100'].includes(String(result.resp_code))) {
    const code = /^\d{8}$/.test(String(result.resp_code)) ? String(result.resp_code) : '未知';
    throw new HuifuBusinessError(code, result);
  }
  return result;
}

export function hostingProjectId(): string {
  const id = paymentSetting('HOSTING_PROJECT_ID');
  if (!id || id.length > 32) throw new HttpError(503, '汇付托管收银台项目号尚未配置');
  return id;
}

export function hostingPaymentParams(data: Data): Record<string, string> {
  try {
    return {
      url: h5PaymentUrl(data.jump_url),
      ...(typeof data.pre_order_id === 'string' && data.pre_order_id
        ? { preOrderId: data.pre_order_id }
        : {}),
    };
  } catch {
    throw new HttpError(502, '未取得有效汇付收银台链接，请查询订单后重试');
  }
}

export function h5PaymentParams(value: unknown): Record<string, string> {
  try {
    let info = value;
    if (typeof info === 'string' && !info.startsWith('https://')) info = JSON.parse(info);
    const url =
      typeof info === 'string'
        ? info
        : (object(info).mweb_url ?? object(info).h5_url ?? object(info).url);
    return { url: h5PaymentUrl(url) };
  } catch {
    throw new HttpError(502, '未取得有效微信 H5 支付链接，请查询订单后重试');
  }
}
