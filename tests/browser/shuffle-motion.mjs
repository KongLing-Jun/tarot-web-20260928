// Real browser motion/layout checks. Auth/config mocks exist only in this context.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const [baseUrl, output] = process.argv.slice(2);
if (!baseUrl || !output) throw new Error('需要本地站点和证据目录');
const baseline = process.argv.includes('--baseline');
const preview = process.argv.includes('--preview');
const primary = baseline || process.argv.includes('--primary') || preview;
const sizes = primary
  ? [[390, 844]]
  : [
      [320, 568],
      [390, 659],
      [390, 844],
      [768, 1024],
      [1024, 768],
      [1440, 1000],
    ];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
const results = [];
try {
  for (const [width, height] of sizes) {
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: width < 500,
    });
    await context.route('**/api/**', (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/auth/me')
        return route.fulfill({ json: { user: { nickname: '洗牌验收', avatarUrl: '' } } });
      if (url.pathname === '/api/config') return route.fulfill({ json: { available: true } });
      throw new Error(`不应发起业务请求：${url.pathname}`);
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(new URL('/reading', baseUrl).href, { waitUntil: 'networkidle' });
    await page
      .getByRole('textbox', { name: '写下你的问题', exact: true })
      .fill('我可以如何更清楚地表达自己的想法？');
    await page.getByRole('button', { name: /带 着 问 题 前 行/ }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-roledescription="轮播"]')?.getAttribute('data-phase') ===
        'idle',
    );
    await page.getByRole('button', { pressed: true }).click();
    const button = (name) => page.getByRole('button', { name, exact: true });
    await button('点击牌堆洗牌').waitFor();
    await page.evaluate(() => document.fonts.ready);
    const geometry = () =>
      page.locator('[data-shuffle-state]').evaluate((el) => {
        const stage = el.firstElementChild;
        const stack = stage.querySelector('img').parentElement.parentElement;
        return {
          stage: stage.getBoundingClientRect().toJSON(),
          stack: stack.getBoundingClientRect().toJSON(),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
    const capture = (state) =>
      page.screenshot({ path: path.join(output, `${width}x${height}-${state}.png`) });
    const idle = await geometry();
    await capture('idle');
    const clockStart = new Date();
    await page.clock.install({ time: clockStart });
    await page.clock.pauseAt(new Date(clockStart.getTime() + 1000));
    assert(await button('开始抽牌').isDisabled(), '未洗牌不能开始抽牌');
    if (width < 500) await button('点击牌堆洗牌').tap();
    else await button('点击牌堆洗牌').press('Enter');
    assert(
      (await button('点击牌堆洗牌').isDisabled()) && (await button('开始抽牌').isDisabled()),
      '洗牌时禁止重复触发与提前抽牌',
    );
    const frames = [];
    for (const time of preview
      ? Array.from({ length: 25 }, (_, i) => i * 96)
      : [0, 480, 960, 1440, 1920, 2360]) {
      await page.locator('[data-shuffle-state]').evaluate((el, time) => {
        for (const animation of el.getAnimations({ subtree: true })) {
          animation.pause();
          animation.currentTime = time;
        }
      }, time);
      const sample = await geometry();
      frames.push({ time, ...sample });
      await capture(`frame-${time}`);
      if (!baseline) {
        assert(Math.abs(sample.stage.height - idle.stage.height) < 1, '洗牌时舞台高度稳定');
        assert(Math.abs(sample.stack.width - idle.stack.width) < 1, '洗牌时牌堆尺寸稳定');
        const visible = await page.locator('[data-shuffle-state] img').evaluateAll((images) =>
          images.map((img) => {
            const r = img.getBoundingClientRect(),
              stage = img.closest('[data-shuffle-state]').firstElementChild.getBoundingClientRect();
            return (
              r.left >= stage.left &&
              r.right <= stage.right &&
              r.top >= stage.top &&
              r.bottom <= stage.bottom
            );
          }),
        );
        assert(visible.every(Boolean), '运动中的牌没有被舞台裁切');
      }
    }
    await page.clock.runFor(2400);
    const ready = await geometry();
    await capture('ready');
    const drawBox = await button('开始抽牌').boundingBox();
    assert(
      drawBox.height >= 44 && drawBox.y + drawBox.height <= height,
      '开始抽牌在首屏且触控区足够',
    );
    assert.equal(
      await button('开始抽牌').locator('..').getByRole('button').count(),
      1,
      '底部只有一个开始抽牌按钮',
    );
    assert.equal(await button('点击牌堆洗牌').isEnabled(), true, '完成后可再次轻点牌堆');
    if (!baseline)
      assert(Math.abs(ready.stage.height - idle.stage.height) < 1, '洗牌完成后牌堆不跳动');
    await button('点击牌堆洗牌').click();
    await page.clock.runFor(2400);
    await button('开始抽牌').waitFor();
    await page.clock.resume();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await button('点击牌堆洗牌').click();
    await button('开始抽牌').waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-shuffle-state]')?.getAttribute('data-shuffle-state') ===
        'ready',
      undefined,
      { timeout: 1000 },
    );
    assert(await button('开始抽牌').isEnabled(), '减少动态效果时立即完成');
    await button('开始抽牌').click();
    await page.getByRole('region', { name: '半圆环牌堆' }).waitFor();
    assert.deepEqual(errors, []);
    assert.equal(idle.overflow, false);
    results.push({ width, height, idle, ready, frames, errors });
    console.log(`PASS ${width}x${height}`);
    await context.close();
  }
} finally {
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
}
