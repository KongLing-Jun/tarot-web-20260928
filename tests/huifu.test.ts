// @vitest-environment node
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as config from '@/lib/api/server-config';
import {
  chinaTime,
  HuifuBusinessError,
  huifuRequest,
  orderTtl,
  sortedJson,
  verifyNotification,
} from '@/lib/server/huifu';

const merchant = generateKeyPairSync('rsa', { modulusLength: 2048 });
const huifu = generateKeyPairSync('rsa', { modulusLength: 2048 });
const settings: Record<string, string> = {
  PAYMENT_V3_MERCHANT_PRIVATE_KEY: merchant.privateKey
    .export({ format: 'der', type: 'pkcs8' })
    .toString('base64'),
  PAYMENT_V3_HUIFU_PUBLIC_KEY: huifu.publicKey
    .export({ format: 'der', type: 'spki' })
    .toString('base64'),
  PAYMENT_V3_GATEWAY_URL: 'https://api.huifu.com/v3/trade/payment/jspay',
  PAYMENT_V3_SYS_ID: 'test-system',
  PAYMENT_V3_PRODUCT_ID: 'PAYUN',
  PAYMENT_V3_ORDER_TTL: '10m',
};
beforeEach(() =>
  vi.spyOn(config, 'getServerSetting').mockImplementation((key) => settings[key] || ''),
);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const signature = (text: string) =>
  sign('RSA-SHA256', Buffer.from(text), huifu.privateKey).toString('base64');

describe('Huifu protocol', () => {
  it('explains duplicate requests and known merchant binding errors without forwarding raw data', () => {
    expect(new HuifuBusinessError('20000000', {}).message).toContain('勿重复提交');
    expect(
      new HuifuBusinessError('22000000', { bank_desc: 'sub_mch_id与sub_appid不匹配 private data' })
        .message,
    ).toContain('AppID 绑定');
    expect(
      new HuifuBusinessError('22000000', { bank_desc: 'sub_mch_id与sub_appid不匹配 private data' })
        .message,
    ).not.toContain('private data');
  });
  it('signs the sorted business object and preserves JSON strings and Unicode', async () => {
    const data = {
      wx_data: '{"sub_openid":"abc","sub_appid":"wx"}',
      trans_amt: '0.01',
      goods_desc: '测试 / 抽卡次数',
    };
    const reply = { resp_code: '00000100', pay_info: '{"z":1,"a":2}' };
    const fetchMock = vi.fn(async (_url, options) => {
      const envelope = JSON.parse(options.body);
      expect(envelope.sys_id).toBe('test-system');
      expect(envelope.data).toEqual(data);
      expect(
        verify(
          'RSA-SHA256',
          Buffer.from(sortedJson(data)),
          merchant.publicKey,
          Buffer.from(envelope.sign, 'base64'),
        ),
      ).toBe(true);
      return Response.json({ data: reply, sign: signature(sortedJson(reply)) });
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await huifuRequest('GATEWAY_URL', data)).toEqual(reply);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('rejects a forged synchronous success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ data: { resp_code: '00000000' }, sign: 'forged' })),
    );
    await expect(huifuRequest('GATEWAY_URL', {})).rejects.toThrow('验签失败');
  });
  it.each([
    ['HOSTING_PREORDER', '/v2/trade/hosting/payment/preorder'],
    ['HOSTING_QUERY', '/v2/trade/hosting/payment/queryorderinfo'],
  ] as const)('signs and verifies the dedicated %s endpoint', async (endpoint, path) => {
    const reply = {
      resp_code: '00000000',
      jump_url: 'https://api.huifu.com/hostingh5/?jump_id=test',
    };
    const fetchMock = vi.fn(async (url, options) => {
      expect(url.href).toBe(`https://api.huifu.com${path}`);
      const envelope = JSON.parse(options.body);
      expect(
        verify(
          'RSA-SHA256',
          Buffer.from(sortedJson(envelope.data)),
          merchant.publicKey,
          Buffer.from(envelope.sign, 'base64'),
        ),
      ).toBe(true);
      return Response.json({ data: reply, sign: signature(sortedJson(reply)) });
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await huifuRequest(endpoint, { req_seq_id: 'order-id' })).toEqual(reply);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('verifies raw asynchronous data without normalizing whitespace or ordering', () => {
    const raw = '{ "trans_stat": "S", "req_seq_id":"abc", "trans_amt":"0.01" }';
    expect(verifyNotification({ resp_data: raw, sign: signature(raw) }).trans_stat).toBe('S');
    expect(() =>
      verifyNotification({ resp_data: JSON.stringify(JSON.parse(raw)), sign: signature(raw) }),
    ).toThrow('验签失败');
    expect(() =>
      verifyNotification({ resp_data: raw.replace('0.01', '0.02'), sign: signature(raw) }),
    ).toThrow('验签失败');
  });
  it('does not leak upstream descriptions in business errors', async () => {
    const data = { resp_code: '90000001', resp_desc: 'sensitive upstream content' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ data, sign: signature(sortedJson(data)) })),
    );
    await expect(huifuRequest('GATEWAY_URL', {})).rejects.toThrow('90000001');
    await expect(huifuRequest('GATEWAY_URL', {})).rejects.not.toThrow('sensitive upstream content');
  });
  it('does not follow redirects or send payment data to a different host', async () => {
    vi.mocked(config.getServerSetting).mockImplementation((key) =>
      key === 'PAYMENT_V3_GATEWAY_URL'
        ? 'https://other.example/v3/trade/payment/jspay'
        : settings[key] || '',
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(huifuRequest('GATEWAY_URL', {})).rejects.toThrow('网关配置无效');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('uses China dates independent of server timezone and validates TTL', () => {
    expect(chinaTime(new Date('2026-09-12T16:01:02Z'))).toBe('20260913000102');
    expect(orderTtl()).toBe(600);
    vi.mocked(config.getServerSetting).mockReturnValue('0m');
    expect(() => orderTtl()).toThrow();
  });
});
