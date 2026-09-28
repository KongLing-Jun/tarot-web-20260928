// Isolated interaction coverage: no real login, AI request or saved reading.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const [baseUrl, output] = process.argv.slice(2);
if (!baseUrl || !output) throw new Error('需要测试站点和截图目录');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
const results = [];
try {
  for (const [width, height, reduced = false] of [
    [320, 568],
    [390, 659],
    [390, 844],
    [1440, 1000],
    [390, 844, true],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: width < 500,
      reducedMotion: reduced ? 'reduce' : 'no-preference',
    });
    await context.route('**/api/**', (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/auth/me')
        return route.fulfill({ json: { user: { nickname: '抽牌验收', avatarUrl: '' } } });
      if (url.pathname === '/api/config') return route.fulfill({ json: { available: true } });
      if (url.pathname.startsWith('/api/assets/')) return route.continue();
      throw new Error(`不应请求业务接口 ${url.pathname}`);
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
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-deck-index]')].every(
        (el) => el.getAnimations().length === 0,
      ),
    );
    const more = page.getByRole('button', { name: '抽牌更多操作', exact: true });
    const capture = (name) =>
      page.screenshot({
        path: path.join(output, `${width}x${height}${reduced ? '-reduced' : ''}-${name}.png`),
      });
    assert.equal(
      await page
        .getByRole('button', {
          name: /^(抽取这张|上一张|下一张|撤回上一张|修改问题|修改牌阵|重新洗牌)$/,
        })
        .count(),
      0,
    );
    assert(await page.getByRole('link', { name: '离开占卜', exact: true }).isVisible());
    const layout = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      height: innerHeight,
      scrollHeight: document.documentElement.scrollHeight,
    }));
    assert(
      layout.scrollWidth <= width && layout.scrollHeight <= height + 1,
      '页面无需滚动且没有横向溢出',
    );
    await capture('idle');
    await more.click();
    const menu = page.getByRole('menu', { name: '抽牌操作' });
    assert(await menu.getByRole('menuitem', { name: '撤回上一张' }).isDisabled());
    const menuBox = await menu.boundingBox();
    assert(
      menuBox.x >= 0 && menuBox.x + menuBox.width <= width && menuBox.y + menuBox.height <= height,
      '菜单没有越界',
    );
    await capture('menu');
    await page.keyboard.press('Escape');
    assert.equal(await menu.count(), 0);
    const hit = await deck.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2,
        y = rect.top + rect.width * 0.17;
      const target = document.elementFromPoint(x, y)?.closest('[data-deck-index]');
      return target ? { x, y, index: target.getAttribute('data-deck-index') } : null;
    });
    assert(hit, '牌堆中央存在可轻点的卡牌');
    const tap = async (x, y) => (width < 500 ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
    await tap(hit.x, hit.y);
    const card = deck.locator(`[data-deck-index="${hit.index}"]`);
    assert.equal(await card.getAttribute('aria-pressed'), 'true');
    assert(await page.getByText('已抽 0 / 3', { exact: true }).isVisible(), '第一次轻点只高亮');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-deck-index]')].every(
        (el) => el.getAnimations().length === 0,
      ),
    );
    await capture('highlight');
    const box = await card.boundingBox();
    await tap(box.x + box.width / 2, box.y + box.height / 2);
    const flight = page.locator('[data-draw-flight]');
    await flight.waitFor();
    assert(await page.getByText('已抽 0 / 3', { exact: true }).isVisible(), '飞出动画完成前不计数');
    if (!reduced) {
      await page.waitForFunction(
        () => document.querySelector('[data-draw-flight]')?.getAnimations()[0]?.currentTime >= 350,
      );
      const flyingBox = await flight.boundingBox();
      assert(flyingBox && flyingBox.width > 70, '抽出的牌明显放大');
      assert(flyingBox.x >= 0 && flyingBox.x + flyingBox.width <= width, '飞出的牌没有超出屏幕');
      await capture('extraction');
    }
    await page.getByText('已抽 1 / 3', { exact: true }).waitFor();
    assert(await card.isDisabled(), '再次轻点只抽取对应一张牌');
    await more.click();
    await menu.getByRole('menuitem', { name: '撤回上一张' }).click();
    await page.getByText('已抽 0 / 3', { exact: true }).waitFor();
    assert(await card.isEnabled());
    for (const index of [0, 38, 77]) {
      const target = deck.locator(`[data-deck-index="${index}"]`);
      await target.press('Enter');
      assert.equal(await target.getAttribute('aria-pressed'), 'true');
      await target.press('Enter');
      await page.locator('[data-draw-flight]').waitFor({ state: 'hidden' });
    }
    await page.getByRole('button', { name: '揭牌更多操作', exact: true }).waitFor();
    assert.equal(await more.count(), 0, '抽齐后进入揭牌');
    assert.deepEqual(errors, []);
    results.push({ width, height, reduced, layout, errors, passed: true });
    console.log(`PASS ${width}x${height} reduced=${reduced}`);
    await context.close();
  }
} finally {
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
}
