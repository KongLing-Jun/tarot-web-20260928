// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import postcss, { type AnyNode } from 'postcss';
import { describe, expect, it } from 'vitest';
import config from '../postcss.config.mjs';

// Turbopack 从生成的 worker 加载插件，测试不能提前替配置补全相对路径。
const require = createRequire(path.resolve('.next/dev/build/postcss.js'));

async function compile(file: string) {
  const from = path.resolve(file);
  const plugins = Object.entries(config.plugins).map(([name, options]) => {
    const plugin = require(name);
    return plugin(options);
  });
  return postcss(plugins).process(await readFile(from, 'utf8'), { from });
}

describe('微信开发者工具 CSS 兼容输出', () => {
  it('洗牌抽牌高度在编译后保留无条件 vh 回退，dvh 只在支持时启用', async () => {
    const { root } = await compile('components/drawing/RitualScene.module.css');
    const base: string[] = [];
    const enhanced: string[] = [];
    root.walkRules('.content', (rule) => {
      rule.walkDecls('height', (declaration) => {
        if (rule.parent?.type === 'root') base.push(declaration.value);
        if (rule.parent?.type === 'atrule' && rule.parent.name === 'supports') {
          expect(rule.parent.params).toMatch(/height:\s*100dvh/);
          enhanced.push(declaration.value);
        }
      });
    });
    expect(base.at(-1)).toBe('100vh');
    expect(enhanced).toContain('100dvh');
  });
  it('基础布局、按钮重置和变量初始化不依赖 Chromium 91 会忽略的层或嵌套规则', async () => {
    const { root } = await compile('app/_styles/globals.css');
    const layers: string[] = [];
    root.walkAtRules('layer', (rule) => {
      layers.push(rule.params);
    });
    expect(layers).toEqual([]);

    const declarations: string[] = [];
    root.walkRules((rule) => {
      expect(rule.parent?.type).not.toBe('rule');
      if (rule.selector === '.fixed') declarations.push(rule.toString());
      if (rule.selector === '.flex') declarations.push(rule.toString());
    });
    expect(declarations.join('\n')).toContain('position: fixed');
    expect(declarations.join('\n')).toContain('display: flex');
    expect(root.toString()).toContain('--tw-border-style: solid');
    expect(root.toString()).toMatch(
      /button[^{}]*\{[^}]*background(?:-color)?:\s*(?:#0000|transparent)/,
    );
    root.walkAtRules('media', (rule) => {
      expect(rule.params).not.toMatch(/(?:width|height)\s*[<>]=?/);
    });
  }, 20000);

  it('手机覆盖样式编译后保留常规媒体查询和 CSS Module 选择器', async () => {
    const { css } = await compile('components/layout/MobileLayout.module.css');
    expect(css).toContain('max-width: 767px');
    expect(css).toContain('.agentHeader');
    expect(css).toContain('.composer');
    expect(css).toContain(':global(.side-nav)');
  });

  it('导航的金色选中样式仅由当前页决定，悬停限定在精确指针设备', async () => {
    const { root } = await compile('app/_styles/globals.css');
    let selectedRules = 0;
    root.walkRules((rule) => {
      if (!rule.selector.includes('.side-nav-link')) return;
      rule.walkDecls('color', (declaration) => {
        if (!/^var\(--gold(?:-[\w]+)?\)$/.test(declaration.value)) return;
        selectedRules++;
        expect(rule.selector.replaceAll('"', '')).toBe('.side-nav-link[aria-current=page]');
      });
      if (rule.selector.includes(':hover')) {
        const ancestors: string[] = [];
        let parent: AnyNode | undefined = rule.parent;
        while (parent) {
          if (parent.type === 'atrule' && parent.name === 'media') ancestors.push(parent.params);
          parent = parent.parent;
        }
        expect(ancestors.join(' ')).toContain('hover: hover');
        expect(ancestors.join(' ')).toContain('pointer: fine');
      }
    });
    expect(selectedRules).toBe(1);
  });

  it('页面包装器不再改写导航尺寸和字体，底部占位复用全局安全区高度', async () => {
    const { root } = await compile('components/layout/MobileLayout.module.css');
    root.walkRules((rule) => {
      if (!rule.selector.includes('.side-nav')) return;
      rule.walkDecls((declaration) => {
        expect(['height', 'padding-bottom', 'gap', 'font-size', 'letter-spacing']).not.toContain(
          declaration.prop,
        );
      });
    });
    const daily = await readFile('app/daily/daily.module.css', 'utf8');
    expect(daily).toContain('padding-bottom: var(--mobile-bottom-space)');
  });
});
