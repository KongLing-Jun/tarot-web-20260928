import { afterEach, describe, expect, it, vi } from 'vitest';
import { countQuestionCharacters } from '@/lib/questionInput';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('提问字数', () => {
  it('计入中英文、标点、空格和换行，并仅为计数归一化 CRLF', () => {
    const text = '你 A。\r\n好';
    expect(countQuestionCharacters(text)).toBe(6);
    expect(countQuestionCharacters(text.replace('\r\n', '\n'))).toBe(6);
    expect(text).toBe('你 A。\r\n好');
    expect(countQuestionCharacters('')).toBe(0);
  });

  it('组合表情、肤色、旗帜和组合音标各按一个可见字符计数', () => {
    expect(countQuestionCharacters('👨‍👩‍👧‍👦👍🏽🇨🇳e\u0301')).toBe(4);
  });

  it('旧 WebView 没有 Segmenter 时按码点降级且不拆开代理对', async () => {
    vi.stubGlobal('Intl', { Segmenter: undefined });
    vi.resetModules();
    const fallback = await import('@/lib/questionInput');
    expect(fallback.countQuestionCharacters('你🙂\r\nA')).toBe(4);
    expect(fallback.countQuestionCharacters('👍🏽')).toBe(2);
  });
});
