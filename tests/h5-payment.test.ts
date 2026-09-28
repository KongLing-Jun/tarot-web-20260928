import { afterEach, describe, expect, it, vi } from 'vitest';
import { h5PaymentUrl, openH5Payment } from '@/lib/payments/h5';
import { h5PaymentParams, hostingPaymentParams } from '@/lib/server/huifu';

const url = 'https://wx.tenpay.com/cgi-bin/mmpayweb-bin/checkmweb?prepay_id=test&package=123';
afterEach(() => vi.unstubAllGlobals());

describe('H5 payment links', () => {
  it('reads Huifu jump_url without requiring a channel transaction ID or amount', () => {
    const jumpUrl = 'https://api.huifu.com/hostingh5/?jump_id=test';
    expect(hostingPaymentParams({ jump_url: jumpUrl, pre_order_id: 'H-test' })).toEqual({
      url: jumpUrl,
      preOrderId: 'H-test',
    });
    expect(hostingPaymentParams({ jump_url: jumpUrl })).toEqual({ url: jumpUrl });
    expect(() => hostingPaymentParams({ pay_info: url })).toThrow('汇付收银台链接');
    expect(() => hostingPaymentParams({ jump_url: 'javascript:alert(1)' })).toThrow(
      '汇付收银台链接',
    );
  });
  it.each([
    url,
    JSON.stringify(url),
    { mweb_url: url },
    JSON.stringify({ mweb_url: url }),
    { h5_url: url },
    { url },
  ])('extracts a validated checkout URL from %j', (value) => {
    expect(h5PaymentParams(value)).toEqual({ url });
  });

  it.each([
    undefined,
    '',
    {},
    'javascript:alert(1)',
    '//wx.tenpay.com/pay',
    'http://wx.tenpay.com/pay',
    'https://user:password@wx.tenpay.com/pay',
    { qr_code: url },
    { mweb_url: 'weixin://wxpay/test' },
  ])('rejects missing, QR-only, and unsafe checkout data: %j', (value) => {
    expect(() => h5PaymentParams(value)).toThrow('未取得有效');
  });

  it('navigates the current page directly to the returned URL', () => {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    openH5Payment(url);
    expect(assign).toHaveBeenCalledExactlyOnceWith(url);
    expect(() => openH5Payment('javascript:alert(1)')).toThrow('无效');
    expect(assign).toHaveBeenCalledTimes(1);
    expect(h5PaymentUrl(url)).toBe(url);
  });
});
