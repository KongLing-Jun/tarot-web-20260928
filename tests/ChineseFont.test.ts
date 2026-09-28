import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import postcss from 'postcss';

const css = postcss.parse(readFileSync('app/_styles/chinese-font.css', 'utf8'));
const coverage = new Map<number, Set<number>>();
css.walkAtRules('font-face', face => {
  let weight = 0;
  let ranges = '';
  face.walkDecls('font-weight', declaration => { weight = Number(declaration.value); });
  face.walkDecls('unicode-range', declaration => { ranges = declaration.value; });
  const points = coverage.get(weight) ?? new Set<number>();
  for (const range of ranges.split(',')) {
    const [start, end = start] = range.replace('U+', '').split('-').map(code => parseInt(code, 16));
    for (let code = start; code <= end; code++) points.add(code);
  }
  coverage.set(weight, points);
});

describe('中文文楷字库', () => {
  it('分片包含有效字体，字符范围不重叠且不覆盖原有英文字体', () => {
    const seen = new Map<number, Set<number>>();
    css.walkAtRules('font-face', face => {
      const values: Record<string, string> = {};
      face.walkDecls(declaration => { values[declaration.prop] = declaration.value; });
      const weight = Number(values['font-weight']);
      const points = seen.get(weight) ?? new Set<number>();
      const asset = values.src.match(/url\("(.*?)"\)/)![1];
      expect(readFileSync(`public${asset}`).subarray(0, 4).toString()).toBe('wOF2');
      for (const range of values['unicode-range'].split(',')) {
        const [start, end = start] = range.replace('U+', '').split('-').map(code => parseInt(code, 16));
        for (let code = start; code <= end; code++) {
          expect(code).toBeGreaterThan(0x7f);
          expect(points.has(code), `重复字符 U+${code.toString(16)}`).toBe(false);
          points.add(code);
        }
      }
      seen.set(weight, points);
    });
    expect([...coverage.keys()].sort()).toEqual([300, 400]);
    expect([...coverage.get(300)!].sort()).toEqual([...coverage.get(400)!].sort());
  });

  it('两个字重均覆盖场景、牌义与任意常用中文输入', () => {
    const text = ['lib/readingEntry.ts', 'lib/tarot/cards.ts', 'components/question/QuestionWelcome.tsx']
      .map(path => readFileSync(path, 'utf8')).join('') + '龘龖麤鑫淼焱垚犇繁體中文';
    const characters = [...new Set([...text].filter(char => /\p{Script=Han}/u.test(char)))];
    for (const weight of [300, 400]) {
      expect(coverage.get(weight)!.size).toBeGreaterThan(20000);
      expect(characters.filter(char => !coverage.get(weight)!.has(char.codePointAt(0)!))).toEqual([]);
    }
  });

  it('保留首页品牌标题字形以及输入框聚焦和圆角规则', () => {
    const home = postcss.parse(readFileSync('app/_styles/home/home-hero.module.css', 'utf8'));
    const titleFonts: string[] = [];
    home.walkRules('.title', rule => {
      rule.walkDecls('font-family', declaration => { titleFonts.push(declaration.value); });
    });
    expect(titleFonts.map(value => value.replaceAll('"', "'"))).toEqual(['\'Miying Home Title\', \'Songti SC\', \'STSong\', serif']);
    const question = postcss.parse(readFileSync('components/question/QuestionWelcome.module.css', 'utf8'));
    const states: Record<string, Record<string, string>> = {};
    question.walkRules(rule => {
      if (!['.writing textarea', '.writing textarea:focus', '.writing textarea:focus-visible'].includes(rule.selector)) return;
      states[rule.selector] = {};
      rule.walkDecls(declaration => { states[rule.selector][declaration.prop] = declaration.value; });
    });
    expect(states['.writing textarea']).toMatchObject({ 'border-radius': '20px', background: 'rgba(234, 228, 212, 0.035)' });
    expect(states['.writing textarea:focus'].background).toBe('rgba(234, 228, 212, 0.06)');
    expect(states['.writing textarea:focus-visible']['outline-offset']).toBe('-2px');
  });
});
