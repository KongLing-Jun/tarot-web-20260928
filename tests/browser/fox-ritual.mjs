import { drawAction } from './draw-menu.mjs';
// Isolated visual/interaction acceptance: mock account/config/save, never call a model.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const baseUrl = process.argv[2];
const output = process.argv[3];
if (!baseUrl || !output) throw new Error('需要站点 URL 与截图目录');
const baseline = process.argv.includes('--baseline');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  channel: process.env.BROWSER_CHANNEL || undefined,
});
const results = [];
let page;
try {
  for (const viewport of baseline || process.argv.includes('--primary-only')
    ? [{ width: 390, height: 844 }]
    : [
        { width: 390, height: 844 },
        { width: 320, height: 740 },
        { width: 360, height: 800 },
        { width: 390, height: 659 },
        { width: 430, height: 932 },
        { width: 1440, height: 1000 },
      ]) {
    const context = await browser.newContext({ viewport, hasTouch: viewport.width < 500 });
    const saved = [];
    await context.route('**/api/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/api/auth/me')
        return route.fulfill({ json: { user: { nickname: '视觉验收用户', avatarUrl: '' } } });
      if (pathname === '/api/config') return route.fulfill({ json: { available: true } });
      if (pathname === '/api/readings' && route.request().method() === 'POST') {
        saved.push(route.request().postDataJSON());
        return route.fulfill({ json: { ok: true } });
      }
      if (pathname.startsWith('/api/assets/')) return route.continue();
      throw new Error(`不应请求 ${pathname}`);
    });
    page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const prefix = `${viewport.width}x${viewport.height}`;
    const capture = async (state) => {
      await page.screenshot({ path: path.join(output, `${prefix}-${state}.png`) });
      console.log(`${prefix} ${state}`);
    };
    await page.goto(new URL('/reading', baseUrl).href, { waitUntil: 'domcontentloaded' });
    console.log('opened reading');
    const question = process.argv.includes('--long-question')
      ? '我可以如何更清楚地表达自己的想法？我希望在沟通中兼顾自己的真实感受与对方的理解，面对意见不同的情况，如何整理思路并采取合适的行动？'.repeat(
          3,
        )
      : '我可以如何更清楚地表达自己的想法？';
    await page.getByRole('textbox', { name: '写下你的问题', exact: true }).fill(question);
    await page.getByRole('button', { name: '下一步，选择牌阵', exact: true }).click();
    const target = page.getByRole('button', { name: /三张牌阵/, pressed: true });
    for (let step = 0; !(await target.count()) && step < 6; step++) {
      await page.getByRole('region', { name: '选择牌阵', exact: true }).press('ArrowRight');
      await page
        .getByRole('region', { name: '选择牌阵', exact: true })
        .waitFor({ state: 'visible' });
      await page.waitForFunction(
        () =>
          document.querySelector('[aria-roledescription="轮播"]')?.getAttribute('data-phase') ===
          'idle',
      );
    }
    assert.equal(await target.count(), 1);
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-roledescription="轮播"]')?.getAttribute('data-phase') ===
        'idle',
    );
    await page.getByRole('button', { pressed: true }).click();
    await page.getByRole('button', { name: '点击牌堆洗牌', exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await capture('shuffle-idle');
    // Freeze timer and animation only for the shuffling comparison frame.
    await page.clock.install();
    await page.getByRole('button', { name: '点击牌堆洗牌', exact: true }).click();
    await page.clock.runFor(650);
    await page.evaluate(() => {
      for (const animation of document.getAnimations()) {
        animation.pause();
        animation.currentTime = 650;
      }
    });
    await capture('shuffling');
    await page.clock.runFor(2400);
    await page.clock.resume();
    await page.getByRole('button', { name: '开始抽牌', exact: true }).waitFor();
    await capture('shuffle-ready');
    await page.getByRole('button', { name: '点击牌堆洗牌', exact: true }).click();
    await page.getByRole('button', { name: '开始抽牌', exact: true }).waitFor();
    assert.equal(saved.length, 0);
    await page.getByRole('button', { name: '开始抽牌', exact: true }).click();
    await page.getByRole('region', { name: '半圆环牌堆' }).waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-deck-index]')].every(
        (el) => el.getAnimations().length === 0,
      ),
    );
    await capture('draw-idle');
    const choose = async (index) => {
      await page.locator(`[data-deck-index="${index}"]`).focus();
      await page.keyboard.press('Enter');
    };
    await choose(30);
    await page.locator('[data-deck-index][aria-pressed="true"]').press('Enter');
    await page.locator('[data-draw-flight]').waitFor({ state: 'hidden' });
    await choose(39);
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-deck-index]')].every(
        (el) => el.getAnimations().length === 0,
      ),
    );
    await capture('draw-preview');
    const dimensions = await page.evaluate(() => {
      const deck = document.querySelector('[aria-label="半圆环牌堆"]');
      const ring = deck.getBoundingClientRect();
      const dock = document
        .querySelector('#fan-instructions')
        .parentElement.getBoundingClientRect();
      const active = deck.querySelector('[aria-pressed="true"]');
      const artwork = active?.querySelector('img');
      const question = document.querySelector('[data-ritual-root] section > div:nth-child(2) p');
      return {
        font: question
          ? {
              family: getComputedStyle(question).fontFamily,
              weight: getComputedStyle(question).fontWeight,
              shadow: getComputedStyle(question).textShadow,
            }
          : null,
        artwork: artwork
          ? {
              src: artwork.src,
              naturalWidth: artwork.naturalWidth,
              rect: artwork.getBoundingClientRect().toJSON(),
              style: artwork.getAttribute('style'),
            }
          : null,
        scrollWidth: document.documentElement.scrollWidth,
        width: innerWidth,
        height: innerHeight,
        ringTop: ring.top,
        ringBottom: ring.bottom,
        dockTop: dock.top,
        dockBottom: dock.bottom,
        cards: deck.querySelectorAll('[data-deck-index]').length,
        images: [...document.images]
          .filter((i) => !i.complete || i.naturalWidth === 0)
          .map((i) => i.src),
      };
    });
    assert(dimensions.scrollWidth <= dimensions.width, '没有页面横向溢出');
    assert.equal(dimensions.cards, 78);
    assert.equal(saved.length, 0, '抽牌未提前保存');
    if (!baseline) {
      assert(dimensions.dockBottom <= viewport.height + 1, '底部动作可见');
      assert(dimensions.ringBottom <= dimensions.dockTop, '牌堆不被底部操作遮挡');
      assert.deepEqual(dimensions.images, []);
    }
    await (await drawAction(page, '撤回上一张')).click();
    await page.getByText('已抽 0 / 3', { exact: true }).waitFor();
    await (await drawAction(page, '修改问题')).click();
    await page.getByRole('dialog').waitFor();
    await capture('edit-confirm');
    await page.getByRole('button', { name: /取\s*消/ }).click();
    assert.equal(await page.getByRole('region', { name: '半圆环牌堆' }).count(), 1);
    for (const name of ['修改牌阵', '重新洗牌']) {
      const action = await drawAction(page, name);
      await action.scrollIntoViewIfNeeded();
      assert(await action.isVisible());
      await action.click();
      await page.getByRole('dialog').waitFor();
      await page.getByRole('button', { name: /取\s*消/ }).click();
    }
    if (process.argv.includes('--long-question')) {
      await (await drawAction(page, '修改问题')).click();
      await page.getByRole('button', { name: '确认修改', exact: true }).click();
      assert.equal(
        await page.getByRole('textbox', { name: '写下你的问题', exact: true }).inputValue(),
        question,
        '两行摘要没有截断原始问题',
      );
    }
    assert.deepEqual(errors, []);
    results.push({ viewport, dimensions, errors, status: 'passed' });
    await context.close();
    page = null;
  }
  await writeFile(
    path.join(output, 'results.json'),
    JSON.stringify(
      { results, limitations: 'Chrome 隔离会话，模拟登录/配置/保存；没有验证微信真机和真实模型。' },
      null,
      2,
    ),
  );
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(output, 'failure.png') });
    console.error(await page.locator('body').innerText());
  }
  throw error;
} finally {
  await browser.close();
}
