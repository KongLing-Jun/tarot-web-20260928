// Isolated acceptance: mocked session/config, no real account, saved reading or model request.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const baseUrl = process.argv[2];
if (!baseUrl || !['http:', 'https:'].includes(new URL(baseUrl).protocol))
  throw new Error('需要测试站点 URL');
const output = path.resolve(process.argv[3] ?? 'docs/verification/spread-selector');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  channel: process.env.BROWSER_CHANNEL || undefined,
});
const ids = ['single', 'three-card', 'two-options', 'relationship', 'timeline', 'celtic-cross'];
const counts = [1, 3, 5, 5, 5, 10];
const results = [];
const errors = [];

async function settle(page, id) {
  await page.waitForFunction((expected) => {
    const stage = document.querySelector('[aria-roledescription="轮播"]');
    return (
      stage?.getAttribute('data-phase') === 'idle' &&
      stage.querySelector('[aria-pressed="true"]')?.getAttribute('data-spread-id') === expected
    );
  }, id);
}

async function touchDrag(input, x, y, dx, cancel = false) {
  await input.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, id: 1 }],
  });
  for (let step = 1; step <= 6; step++) {
    await input.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + (dx * step) / 6, y, id: 1 }],
    });
  }
  await input.send('Input.dispatchTouchEvent', {
    type: cancel ? 'touchCancel' : 'touchEnd',
    touchPoints: [],
  });
}

async function checkActionLayout(page, capturePath) {
  const back = page.getByRole('button', { name: '返回问题', exact: true });
  const exit = page.getByRole('link', { name: '离开', exact: true });
  await back.scrollIntoViewIfNeeded();
  const measure = async () => {
    const buttons = [];
    for (const control of [back, exit]) {
      buttons.push(
        await control.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            fontSize: parseFloat(getComputedStyle(node).fontSize),
          };
        }),
      );
    }
    assert(
      buttons.every((b) => b.height >= 44 && b.width >= 44),
      '顶部入口触控区域充足',
    );
    assert(
      buttons[0].x < buttons[1].x && Math.abs(buttons[0].y - buttons[1].y) <= 1,
      '返回居左，离开居右且同一行',
    );
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      '页面无横向溢出',
    );
    return { buttons };
  };
  const baseline = await measure();
  for (const control of [back, exit]) {
    await control.focus();
    await control.hover();
    assert.deepEqual(await measure(), baseline, '聚焦与悬停不改变导航布局');
  }
  if (capturePath) await page.screenshot({ path: capturePath, fullPage: true });
  return baseline;
}

try {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 320, height: 740 },
    { width: 360, height: 800 },
    { width: 375, height: 812 },
    { width: 414, height: 896 },
    { width: 428, height: 926 },
    { width: 390, height: 720 },
    { width: 844, height: 390 },
    { width: 1440, height: 1000 },
    { width: 390, height: 540 },
  ]) {
    const context = await browser.newContext({
      viewport,
      hasTouch: viewport.width < 500,
      isMobile: viewport.width < 500,
      deviceScaleFactor: viewport.width < 500 ? 3 : 1,
      reducedMotion: 'no-preference',
    });
    const fallbackFont = viewport.width === 390 && viewport.height === 720;
    await context.route('**/api/**', (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/api/auth/me')
        return route.fulfill({ json: { user: { nickname: '牌阵验收用户', avatarUrl: '' } } });
      if (pathname === '/api/config') return route.fulfill({ json: { available: true } });
      if (pathname.startsWith('/api/assets/')) return route.continue();
      throw new Error(`择阵测试不应请求 ${pathname}`);
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(new URL('/reading', baseUrl).href);
    if (fallbackFont)
      await page.addStyleTag({ content: '[class*="spreadHeader"] button { font-family: serif; }' });
    await page
      .getByRole('textbox', { name: '写下你的问题', exact: true })
      .fill('我可以如何更清楚地表达自己的想法？');
    await page.getByRole('button', { name: /带 着 问 题 前 行/ }).click();
    const stage = page.getByRole('region', { name: '选择牌阵', exact: true });
    const confirm = page.getByRole('button', { pressed: true });
    assert.equal(
      await page.getByRole('button', { name: /上一个牌阵|下一个牌阵|就 此 落 阵/ }).count(),
      0,
    );
    await settle(page, 'three-card');
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        document
          .querySelector('[aria-roledescription="轮播"]')
          .parentElement.parentElement.getAnimations()
          .map((animation) => animation.finished),
      );
      window.scrollTo(0, 0);
    });
    const layout = await stage.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const card = element.querySelector('[data-slot="0"]');
      const center = card.getBoundingClientRect();
      const sideBoxes = [-1, 1].map((slot) =>
        element.querySelector(`[data-slot="${slot}"]`).getBoundingClientRect(),
      );
      return {
        stageTop: box.top,
        cardWidth: center.width,
        width: box.width,
        centered: Math.abs(center.left + center.width / 2 - box.left - box.width / 2) < 2,
        sidesVisible: sideBoxes.every(
          (side) => Math.min(side.right, box.right) - Math.max(side.left, box.left) > 10,
        ),
        sidesSmaller: sideBoxes.every((side) => side.width < center.width),
        noOverflow: document.documentElement.scrollWidth <= innerWidth,
        copyFits: [...card.querySelectorAll('h4,p')].every(
          (node) =>
            node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight + 1,
        ),
      };
    });
    assert(
      layout.centered && layout.sidesVisible && layout.sidesSmaller,
      `中央与侧卡布局 ${JSON.stringify(layout)}`,
    );
    assert(layout.noOverflow && layout.copyFits, '无页面横向溢出或文字裁切');
    const buttonBox = await confirm.boundingBox();
    await page.screenshot({
      path: path.join(output, `${viewport.width}x${viewport.height}.png`),
      fullPage: true,
    });
    if (viewport.height >= 812)
      assert(
        buttonBox.y + buttonBox.height <= viewport.height,
        `确认首屏可见 ${JSON.stringify({ viewport, buttonBox })}`,
      );
    const actions = await checkActionLayout(
      page,
      path.join(output, `${viewport.width}x${viewport.height}-hover.png`),
    );

    // Arrow navigation visits all six diagrams and wraps in both directions.
    for (let step = 1; step <= 6; step++) {
      await stage.press('ArrowRight');
      assert.equal(await stage.getAttribute('aria-busy'), 'true');
      const index = (1 + step) % ids.length;
      await settle(page, ids[index]);
      assert(await confirm.isEnabled());
      assert.equal(await stage.locator('[data-slot="0"] svg g').count(), counts[index]);
    }
    await stage.press('ArrowLeft');
    await settle(page, 'single');
    await stage.press('ArrowLeft');
    await settle(page, 'celtic-cross');
    await page.screenshot({
      path: path.join(output, `${viewport.width}-celtic.png`),
      fullPage: true,
    });

    await stage.focus();
    await page.keyboard.press('ArrowRight');
    await settle(page, 'single');
    const side = await stage.locator('[data-slot="1"]').boundingBox();
    const stageBox = await stage.boundingBox();
    await page.mouse.click(
      Math.min(side.x + side.width / 2, stageBox.x + stageBox.width - 10),
      side.y + side.height / 2,
    );
    await settle(page, 'three-card');

    await stage.scrollIntoViewIfNeeded();
    const box = await stage.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    if (viewport.width < 500) {
      const input = await context.newCDPSession(page);
      await touchDrag(input, x, y, -90);
      await settle(page, 'two-options');
      await touchDrag(input, x, y, 12);
      await settle(page, 'two-options');
      await touchDrag(input, x, y, -90, true);
      await settle(page, 'two-options');
      await input.detach();
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x - 100, y, { steps: 8 });
      assert.equal(await stage.getAttribute('aria-busy'), 'true');
      await page.mouse.up();
      await settle(page, 'two-options');
      await page.mouse.move(x, y);
      await page.mouse.wheel(130, 0);
      await settle(page, 'relationship');
      await stage.focus();
      await page.keyboard.press('ArrowLeft');
      await settle(page, 'two-options');
    }

    // Backtracking preserves the selection; confirm uses the visible spread.
    const back = page.getByRole('button', { name: '返回问题' });
    if (viewport.width < 500) await back.tap();
    else await back.click();
    await page.getByRole('button', { name: /带 着 问 题 前 行/ }).click();
    await settle(page, 'two-options');
    if (viewport.width < 500) await confirm.tap();
    else await confirm.click();
    await page.getByText('二择一牌阵 · 共 5 张', { exact: true }).waitFor();
    assert.equal(await stage.count(), 0, '直接轻点中央牌阵进入洗牌');

    // Reduced motion and a smaller viewport preserve a usable, centered selector.
    await page.goto(new URL('/reading', baseUrl).href);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page
      .getByRole('textbox', { name: '写下你的问题', exact: true })
      .fill('接下来可以怎么做？');
    await page.getByRole('button', { name: /带 着 问 题 前 行/ }).click();
    await stage.press('ArrowRight');
    await settle(page, 'two-options');
    await page.setViewportSize({ width: Math.min(viewport.width, 390), height: 540 });
    await settle(page, 'two-options');
    await confirm.scrollIntoViewIfNeeded();
    assert((await confirm.isVisible()) && (await confirm.isEnabled()));
    if (viewport.width === 390 && viewport.height === 540) {
      await page.addStyleTag({ content: 'html { font-size: 24px; }' });
      await confirm.scrollIntoViewIfNeeded();
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        '字体放大后无横向溢出',
      );
      assert(
        await stage
          .locator('[data-slot="0"] [data-position-label]')
          .first()
          .evaluate((label) => parseFloat(getComputedStyle(label).fontSize) >= 18),
        '字体放大后牌位编号同步放大',
      );
      assert(
        await stage
          .locator('[data-slot="0"]')
          .evaluate((card) =>
            [...card.querySelectorAll('h4,p')].every(
              (node) =>
                node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight + 1,
            ),
          ),
        '字体放大后文案完整',
      );
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(output, '390-large-text.png'), fullPage: true });
    }
    if (viewport.width === 320 || (viewport.width === 390 && viewport.height === 540)) {
      await page.addStyleTag({ content: 'html { font-size: 24px; }' });
      const enlarged = await checkActionLayout(
        page,
        path.join(output, `${viewport.width}-large-text-hover.png`),
      );
      assert(
        enlarged.buttons.every(
          (button, index) => button.fontSize >= actions.buttons[index].fontSize * 1.5,
        ),
        'action text enlarged to 150%',
      );
    }
    results.push({
      viewport,
      layout,
      actions,
      fallbackFont,
      touch: viewport.width < 500,
      passed: true,
    });
    await context.close();
  }
  assert.deepEqual(errors, [], '无浏览器运行时或控制台错误');
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ results, errors }, null, 2));
} finally {
  await browser.close();
}
