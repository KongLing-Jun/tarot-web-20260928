// Exercise the mobile focusout-before-click sequence with isolated account and persistence.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const { chromium, webkit } = createRequire(import.meta.url)('playwright');
const [baseUrl, output] = process.argv.slice(2);
if (!baseUrl || !output) throw new Error('需要测试站点和证据目录');
await mkdir(output, { recursive: true });
const safari = process.env.BROWSER_ENGINE === 'webkit';
const browser = await (safari ? webkit : chromium).launch(
  safari ? {} : { channel: process.env.BROWSER_CHANNEL || undefined },
);
const results = [];
try {
  for (const { revealed, forceBlur } of [
    { revealed: 0, forceBlur: true },
    { revealed: 0, forceBlur: false },
    { revealed: 1, forceBlur: true },
    { revealed: 1, forceBlur: false },
  ]) {
    const prefix = `${revealed}-${forceBlur ? 'interrupted' : 'native'}`;
    const context = await browser.newContext({
      viewport: { width: 390, height: 659 },
      hasTouch: true,
      isMobile: true,
      reducedMotion: 'reduce',
    });
    let saves = 0;
    await context.route('**/api/**', (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/auth/me')
        return route.fulfill({ json: { user: { nickname: '触摸验收', avatarUrl: '' } } });
      if (url.pathname === '/api/config') return route.fulfill({ json: { available: true } });
      if (url.pathname === '/api/readings' && route.request().method() === 'POST') {
        saves++;
        return route.fulfill({ json: { ok: true } });
      }
      if (url.pathname.startsWith('/api/assets/')) return route.continue();
      throw new Error(`意外业务请求 ${url.pathname}`);
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(new URL('/reading', baseUrl).href);
    await page.getByRole('textbox', { name: '写下你的问题', exact: true }).fill('最近的运势如何？');
    await page.getByRole('button', { name: '下一步，选择牌阵', exact: true }).click();
    await page.getByRole('button', { pressed: true }).click();
    await page.getByRole('button', { name: '点击牌堆洗牌', exact: true }).click();
    await page.getByRole('button', { name: '开始抽牌', exact: true }).click();
    const deck = page.getByRole('region', { name: '半圆环牌堆' });
    await deck.waitFor();
    const base = await deck.evaluate((el) => ({
      width: el.clientWidth,
      viewport: el.parentElement.clientHeight,
      arena: el.parentElement.parentElement.clientHeight,
    }));
    assert.equal(base.viewport, base.arena, '整块牌桌可用于缩放显示');
    await deck.focus();
    for (let i = 0; i < 4; i++) await deck.press('+');
    assert(Math.abs((await deck.evaluate((el) => el.clientWidth)) / base.width - 2) < 0.02);
    for (const key of ['End', 'Home']) {
      await deck.press(key);
      const visible = await deck.evaluate((el) => {
        const card = el.querySelector('[aria-pressed="true"]').getBoundingClientRect();
        const view = el.parentElement.getBoundingClientRect();
        return (
          card.left >= view.left - 1 &&
          card.right <= view.right + 1 &&
          card.top >= view.top - 1 &&
          card.bottom <= view.bottom + 1
        );
      });
      assert(visible, `${key} 放大后可查看完整边缘牌`);
    }
    await deck.press('0');
    for (const index of [0, 38, 77]) {
      const card = page.locator(`[data-deck-index="${index}"]`);
      if ((await card.getAttribute('aria-pressed')) !== 'true') await card.press('Enter');
      await card.press('Enter');
      await page.locator('[data-draw-flight]').waitFor({ state: 'hidden' });
    }
    if (revealed) {
      await page.getByRole('button', { name: '过去，点击揭牌' }).tap();
    }
    await page.getByRole('button', { name: '揭牌更多操作' }).tap();
    await page.evaluate((forceBlur) => {
      window.menuBlurCount = 0;
      window.menuEvents = [];
      for (const type of [
        'pointerdown',
        'pointerup',
        'touchstart',
        'touchend',
        'focusin',
        'focusout',
        'mousedown',
        'mouseup',
        'click',
      ]) {
        document.addEventListener(
          type,
          (event) =>
            window.menuEvents.push({
              type,
              target: event.target?.textContent?.slice(0, 50),
              role: event.target?.getAttribute?.('role'),
              related: event.relatedTarget?.tagName,
              active: document.activeElement?.textContent?.slice(0, 50),
            }),
          true,
        );
      }
      document.addEventListener('focusout', (event) => {
        if (event.target?.getAttribute('role') === 'menuitem' && !event.relatedTarget)
          window.menuBlurCount++;
      });
      document.addEventListener(
        'pointerdown',
        (event) => {
          if (forceBlur && event.target.closest('[role="menuitem"]'))
            document.activeElement?.blur();
        },
        { once: true, capture: true },
      );
    }, forceBlur);
    await page.getByRole('menuitem', { name: '全部揭牌' }).tap();
    await page.screenshot({ path: path.join(output, `revealed-${prefix}-after-tap.png`) });
    await writeFile(
      path.join(output, `events-${prefix}.json`),
      JSON.stringify(await page.evaluate(() => window.menuEvents), null, 2),
    );
    await page.getByText('已揭 3 / 3', { exact: true }).waitFor();
    await page.getByRole('button', { name: '解读这些牌' }).waitFor();
    assert.equal(await page.getByRole('menu').count(), 0);
    if (forceBlur)
      assert(
        await page.evaluate(() => window.menuBlurCount > 0),
        '复现了点击前 relatedTarget 为空的失焦',
      );
    assert.equal(saves, 1, '全部揭牌只保存一次');
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, `revealed-${prefix}-all.png`) });
    results.push({ revealed, forceBlur, saves, errors, passed: true });
    console.log(
      `PASS ${safari ? 'WebKit' : 'Chromium'} revealed=${revealed} forceBlur=${forceBlur}`,
    );
    await context.close();
  }
} finally {
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
}
