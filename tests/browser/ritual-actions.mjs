import { drawAction } from './draw-menu.mjs';
// Real browser styling/interaction checks; API mocks are confined to this test context.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const postcss = createRequire(import.meta.url)('postcss');
const [baseUrl, output] = process.argv.slice(2);
if (!baseUrl || !output) throw new Error('需要站点 URL 与证据目录');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
const results = [];
let page;
try {
  const viewports = process.argv.includes('--primary-only')
    ? [{ width: 390, height: 744 }]
    : [
        { width: 390, height: 744 },
        { width: 390, height: 844 },
        { width: 320, height: 568 },
        { width: 320, height: 640 },
        { width: 360, height: 740 },
        { width: 390, height: 659 },
        { width: 1440, height: 1000 },
      ];
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport, hasTouch: viewport.width < 500 });
    if (process.argv.includes('--legacy-viewport')) {
      // Emulate just unsupported viewport units in delivered CSS, not an old browser via user-agent.
      await context.route('**/*.css*', async (route) => {
        const response = await route.fetch();
        const root = postcss.parse(await response.text());
        root.walkAtRules('supports', (rule) => {
          if (/height:\s*100dvh/.test(rule.params)) rule.remove();
        });
        root.walkDecls((declaration) => {
          if (/\d(?:dvh|svh|lvh)\b/.test(declaration.value)) declaration.remove();
        });
        await route.fulfill({ response, body: root.toString() });
      });
    }
    await context.route('**/api/**', (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/api/auth/me')
        return route.fulfill({ json: { user: { nickname: '样式验收', avatarUrl: '' } } });
      if (pathname === '/api/config') return route.fulfill({ json: { available: true } });
      if (pathname.startsWith('/api/assets/')) return route.continue();
      throw new Error(`不应请求 ${pathname}`);
    });
    page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const prefix = `${viewport.width}x${viewport.height}`;
    const capture = (state) =>
      page.screenshot({ path: path.join(output, `${prefix}-${state}.png`) });
    const edit = (name) => page.getByRole('button', { name, exact: true });
    const checkButtons = async (names) => {
      const layout = await page.evaluate(() => ({
        height: innerHeight,
        scroll: document.documentElement.scrollHeight,
        y: scrollY,
        sceneHeight: document.querySelector('[data-ritual-root] section').getBoundingClientRect()
          .height,
      }));
      assert(layout.scroll <= layout.height + 1, `单屏无需纵向滚动: ${JSON.stringify(layout)}`);
      assert(
        Math.abs(layout.sceneHeight - layout.height) <= 1,
        `场景必须占满视口而非塌缩: ${JSON.stringify(layout)}`,
      );
      assert.equal(layout.y, 0, '验收时不滚动页面来露出按钮');
      const measurements = [];
      for (const name of names) {
        const button = edit(name);
        const box = await button.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          const range = document.createRange();
          const text = [...el.childNodes].find(
            (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
          );
          if (text) range.selectNodeContents(text);
          const label = text ? range.getBoundingClientRect() : rect;
          const atCenter = document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          );
          const atLabel = document.elementFromPoint(label.x + label.width / 2, label.bottom - 1);
          return {
            width: rect.width,
            height: rect.height,
            inViewport: rect.top >= 0 && rect.bottom <= innerHeight + 1,
            labelFits: label.left >= rect.left && label.right <= rect.right,
            hit: atCenter === el || el.contains(atCenter),
            labelVisible: atLabel === el || el.contains(atLabel),
            disabled: el.disabled,
            opacity: getComputedStyle(el).opacity,
          };
        });
        assert(box.height >= 44, `${name} 点击高度`);
        assert(box.inViewport, `${name} 完整处于首屏`);
        assert(box.labelFits, `${name} 文字未裁切`);
        assert(box.hit, `${name} 未被底栏或装饰遮挡`);
        assert(box.labelVisible, `${name} 文字未被底栏遮挡`);
        measurements.push({ name, ...box });
      }
      return measurements;
    };
    await page.goto(new URL('/reading', baseUrl).href);
    await page
      .getByRole('textbox', { name: '写下你的问题', exact: true })
      .fill(
        process.argv.includes('--long-question')
          ? '我可以如何更清楚地表达自己的想法，同时兼顾自己的真实感受与对方的理解？'.repeat(5)
          : '你好。',
      );
    await page.getByRole('button', { name: /带 着 问 题 前 行/ }).click();
    for (
      let step = 0;
      !(await page.getByRole('button', { name: /单张牌/, pressed: true }).count()) && step < 6;
      step++
    ) {
      const current = await page.getByRole('button', { pressed: true }).getAttribute('aria-label');
      await page.getByRole('region', { name: '选择牌阵', exact: true }).press('ArrowRight');
      await page.waitForFunction(
        (previous) =>
          document
            .querySelector('[aria-label="选择牌阵"] [aria-pressed="true"]')
            ?.getAttribute('aria-label') !== previous,
        current,
      );
      await page.waitForFunction(
        () =>
          document.querySelector('[aria-label="选择牌阵"]')?.getAttribute('aria-busy') === 'false',
      );
    }
    assert.equal(await page.getByRole('button', { name: /单张牌/, pressed: true }).count(), 1);
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-roledescription="轮播"]')?.getAttribute('data-phase') ===
        'idle',
    );
    await page.getByRole('button', { pressed: true }).click();
    await edit('点击牌堆洗牌').waitFor();
    await page.getByText('单张牌 · 共 1 张', { exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    const artwork = await page
      .locator('[data-shuffle-state] > div')
      .first()
      .evaluate((el) => {
        const stage = el.getBoundingClientRect();
        const card = el.querySelector('img')?.getBoundingClientRect();
        return {
          stageHeight: stage.height,
          cardWidth: card?.width ?? 0,
          cardHeight: card?.height ?? 0,
        };
      });
    assert(
      artwork.stageHeight >= 100 && artwork.cardWidth >= 40 && artwork.cardHeight >= 60,
      `洗牌舞台与卡牌必须实际可见: ${JSON.stringify(artwork)}`,
    );
    const shuffle = await checkButtons(['修改问题', '修改牌阵', '点击牌堆洗牌']);
    await capture('shuffle');
    const shuffleSection = page.getByRole('region', { name: '洗牌', exact: true });
    const shuffleActions = shuffleSection
      .locator('button')
      .filter({ hasText: '修改问题' })
      .locator('..');
    await shuffleActions.screenshot({ path: path.join(output, `${prefix}-shuffle-actions.png`) });
    await page.clock.install();
    await edit('点击牌堆洗牌').click();
    await page.clock.runFor(650);
    await checkButtons(['修改问题', '修改牌阵', '点击牌堆洗牌', '开始抽牌']);
    await capture('shuffling');
    await page.clock.runFor(2400);
    await page.clock.resume();
    await edit('开始抽牌').waitFor();
    await checkButtons(['修改问题', '修改牌阵', '开始抽牌', '点击牌堆洗牌']);
    await capture('shuffle-ready');
    await edit('点击牌堆洗牌').click();
    await edit('开始抽牌').waitFor();
    for (const name of ['修改问题', '修改牌阵']) {
      await edit(name).click();
      await page.getByRole('dialog').waitFor();
      await page.getByRole('button', { name: /取\s*消/ }).click();
    }
    await edit('开始抽牌').click();
    await page.getByRole('region', { name: '半圆环牌堆' }).waitFor();
    await page.locator('[data-deck-index="39"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-deck-index]')].every(
        (el) => el.getAnimations().length === 0,
      ),
    );
    assert(await (await drawAction(page, '撤回上一张')).isDisabled());
    await page.keyboard.press('Escape');
    const draw = await checkButtons(['抽牌更多操作']);
    await capture('draw');
    await drawAction(page, '修改问题');
    const drawActions = page.getByRole('menu', { name: '抽牌操作' });
    await drawActions.screenshot({ path: path.join(output, `${prefix}-draw-actions.png`) });
    const nav = page.locator('#fan-instructions').locator('..');
    await nav.screenshot({ path: path.join(output, `${prefix}-navigation.png`) });
    await page.keyboard.press('Escape');
    await page.getByRole('region', { name: '半圆环牌堆' }).press('ArrowRight');
    assert.equal(await page.locator('[data-deck-index="40"]').getAttribute('aria-pressed'), 'true');
    await page.getByRole('region', { name: '半圆环牌堆' }).press('ArrowLeft');
    assert.equal(await page.locator('[data-deck-index="39"]').getAttribute('aria-pressed'), 'true');
    for (const name of ['修改问题', '修改牌阵', '重新洗牌']) {
      await (await drawAction(page, name)).click();
      await page.getByRole('dialog').waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('dialog').count(), 0);
    }
    await (await drawAction(page, '修改问题')).focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), '修改牌阵');
    await capture('keyboard-focus');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    for (const resource of ['feather.svg', 'cards.svg']) {
      const response = await context.request.get(
        new URL(`/brand/ritual-theme/icons/${resource}`, baseUrl).href,
      );
      assert.equal(response.status(), 200);
    }
    assert.deepEqual(errors, []);
    results.push({
      viewport,
      artwork,
      legacyViewportUnits: process.argv.includes('--legacy-viewport'),
      shuffle,
      draw,
      errors,
      status: 'passed',
    });
    console.log(`${prefix} passed`);
    await context.close();
    page = null;
  }
  await writeFile(
    path.join(output, 'results.json'),
    JSON.stringify({ results, limitations: 'Chrome 隔离模拟登录/配置；未验证微信真机。' }, null, 2),
  );
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') });
  throw error;
} finally {
  await browser.close();
}
