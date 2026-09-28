import { revealAction } from './reveal-actions.mjs';
import { drawAction } from './draw-menu.mjs';
// Isolated browser acceptance: mocked session/config and recording; no real account, model or persisted readings.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const baseUrl = process.argv[2];
if (!baseUrl || !['http:', 'https:'].includes(new URL(baseUrl).protocol))
  throw new Error('需要测试站点 URL');
const output = path.resolve(process.argv[3] ?? 'docs/tasks/fan-stage-20260911');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  channel: process.env.BROWSER_CHANNEL || undefined,
});
const results = [];
const errors = [];
const screenshots = !process.argv.includes('--no-screenshots');
let activePage;
let activeCapture;

async function openDraw(page, name) {
  await page.goto(new URL('/reading', baseUrl).href);
  await page
    .getByRole('textbox', { name: '写下你的问题', exact: true })
    .fill('我可以如何更清楚地表达自己的想法？');
  await page.getByRole('button', { name: '下一步，选择牌阵', exact: true }).click();
  const visited = new Set();
  while (!(await page.getByRole('button', { name: new RegExp(name), pressed: true }).count())) {
    const current = await page.getByRole('button', { pressed: true }).getAttribute('aria-label');
    assert(!visited.has(current), `未找到牌阵：${name}`);
    visited.add(current);
    await page.getByRole('region', { name: '选择牌阵', exact: true }).press('ArrowRight');
    await page.waitForFunction(
      (previous) =>
        document
          .querySelector('[aria-label="选择牌阵"] [aria-pressed="true"]')
          ?.getAttribute('aria-label') !== previous,
      current,
    );
  }
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-roledescription="轮播"]')?.getAttribute('data-phase') ===
      'idle',
  );
  await page.getByRole('button', { pressed: true }).click();
  await page.getByRole('button', { name: '点击牌堆洗牌', exact: true }).click();
  const start = page.getByRole('button', { name: '开始抽牌', exact: true });
  await start.click();
  await page.getByRole('region', { name: '半圆环牌堆' }).waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-deck-index]')].every(
      (el) => el.getAnimations().length === 0,
    ),
  );
}

async function choose(page, index) {
  const card = page.locator(`[data-deck-index="${index}"]`);
  await card.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    (i) =>
      document.querySelector(`[data-deck-index="${i}"]`)?.getAttribute('aria-pressed') === 'true',
    index,
  );
  // Let the authored preview transition settle before source-location assertions.
  await page.waitForFunction(
    (i) => document.querySelector(`[data-deck-index="${i}"]`).getAnimations().length === 0,
    index,
  );
}

async function extract(page) {
  await page.locator('[data-deck-index][aria-pressed="true"]').press('Enter');
  await page.locator('[data-draw-flight]').waitFor({ state: 'hidden' });
}

async function touchGesture(input, frames, beforeRelease) {
  const points = (frame) => frame.map((point, id) => ({ ...point, id }));
  await input.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: points(frames[0]),
  });
  for (const frame of frames.slice(1)) {
    await input.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(frame) });
  }
  await beforeRelease?.();
  await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function pinchDeck(deck, input, targetZoom, pan = false) {
  const geometry = await deck.evaluate((el) => {
    const rect = el.parentElement.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      width: rect.width,
      zoom: parseFloat(el.style.width) / 100,
    };
  });
  const ratio = targetZoom / geometry.zoom;
  const halfDistance = (geometry.width * 0.2) / Math.max(1, ratio);
  await touchGesture(
    input,
    Array.from({ length: 9 }, (_, step) => {
      const progress = step / 8;
      const distance = halfDistance * (1 + (ratio - 1) * progress);
      const x = geometry.x - (pan ? geometry.width * 0.15 * progress : 0);
      return [
        { x: x - distance, y: geometry.y },
        { x: x + distance, y: geometry.y },
      ];
    }),
  );
  assert(
    Math.abs((await deck.evaluate((el) => parseFloat(el.style.width))) - targetZoom * 100) < 1,
    '双指改变局部牌堆宽度',
  );
  assert.equal(await deck.locator('button:disabled').count(), 0, '双指结束不应误抽牌');
}

async function activeGeometry(deck) {
  return deck.evaluate((el) => {
    const card = el.querySelector('[aria-pressed="true"]');
    const rect = card.getBoundingClientRect();
    const matrix = new DOMMatrixReadOnly(getComputedStyle(card).transform);
    const angle = Math.atan2(matrix.b, matrix.a);
    const ends = [
      el.querySelector('[data-deck-index="0"]'),
      el.querySelector('[data-deck-index="77"]'),
    ].map((node) => node.getBoundingClientRect());
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      nx: Math.sin(angle),
      ny: -Math.cos(angle),
      cardHeight: card.offsetHeight,
      index: card.dataset.deckIndex,
      cx: (ends[0].left + ends[0].width / 2 + ends[1].left + ends[1].width / 2) / 2,
      cy: (ends[0].top + ends[0].height / 2 + ends[1].top + ends[1].height / 2) / 2,
    };
  });
}

try {
  for (const viewport of [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 390, height: 659 },
    { width: 1440, height: 1000 },
  ]) {
    const captureName = `${viewport.width}x${viewport.height}`;
    const context = await browser.newContext({
      viewport,
      hasTouch: viewport.width < 500,
      reducedMotion: 'no-preference',
    });
    const savedReadings = [];
    await context.route('**/api/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/api/auth/me')
        return route.fulfill({ json: { user: { nickname: '抽牌验收用户', avatarUrl: '' } } });
      if (pathname === '/api/config') return route.fulfill({ json: { available: true } });
      if (pathname === '/api/readings' && route.request().method() === 'POST') {
        savedReadings.push(route.request().postDataJSON());
        return route.fulfill({ json: { ok: true } });
      }
      if (pathname.startsWith('/api/assets/')) return route.continue();
      throw new Error(`抽牌测试不应请求 ${pathname}`);
    });
    const page = await context.newPage();
    activePage = page;
    activeCapture = captureName;
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const count = viewport.width === 430 ? 10 : viewport.width === 390 ? 3 : 1;
    await openDraw(page, count === 10 ? '凯尔特十字' : count === 3 ? '三张牌阵' : '单张牌');
    assert.equal(await page.locator('[data-deck-index]').count(), 78);
    assert.equal(
      await page.getByRole('list', { name: '已选阵位' }).count(),
      0,
      '不再展示顶部牌位区',
    );
    assert.equal(await page.locator('[data-slot]').count(), 0);
    assert(await (await drawAction(page, '撤回上一张')).isDisabled(), '尚未抽取时不能撤回');
    await page.keyboard.press('Escape');
    const dimensions = await page.evaluate(() => {
      const deck = document.querySelector('[aria-label="半圆环牌堆"]');
      const ring = deck.getBoundingClientRect();
      const progress = document
        .querySelector('[aria-label="抽牌"] [role="status"]')
        .getBoundingClientRect();
      const dock = document
        .querySelector('#fan-instructions')
        .parentElement.getBoundingClientRect();
      return {
        width: window.innerWidth,
        scroll: document.documentElement.scrollWidth,
        viewportHeight: deck.parentElement.clientHeight,
        arenaHeight: deck.parentElement.parentElement.clientHeight,
        deckWidth: ring.width,
        zoom: parseFloat(deck.style.width),
        ringTop: ring.top,
        ringBottom: ring.bottom,
        progressGap: ring.top - progress.bottom,
        dockTop: dock.top,
        dockBottom: dock.bottom,
        clipped: [...document.querySelectorAll('[data-deck-index]')].some((el) => {
          const rect = el.getBoundingClientRect();
          return (
            rect.left < ring.left - 1 ||
            rect.right > ring.right + 1 ||
            rect.top < ring.top - 1 ||
            rect.bottom > ring.bottom + 1
          );
        }),
      };
    });
    assert(
      Math.abs(dimensions.viewportHeight - dimensions.arenaHeight) < 1,
      '缩放视窗覆盖整块可用牌桌，不被原始牌环高度裁切',
    );
    assert.equal(dimensions.clipped, false);
    assert(dimensions.scroll <= dimensions.width, '页面横向溢出');
    assert.equal(dimensions.zoom, 100, '默认完整牌堆保持 100%');
    assert(
      dimensions.progressGap >= -1,
      `牌堆应紧接进度区，无牌位区高度占位: ${JSON.stringify(dimensions)}`,
    );
    assert(
      dimensions.ringTop >= 0 && dimensions.ringBottom <= dimensions.dockTop,
      `默认牌环应在首屏完整显示且不被底部操作遮挡: ${JSON.stringify(dimensions)}`,
    );
    assert(dimensions.dockBottom <= viewport.height + 1, '固定底部操作应在可视范围内');
    if (screenshots)
      await page.screenshot({ path: path.join(output, `${captureName}-fan.png`), fullPage: true });

    // Real pointer hit: tap the visible top layer, not the obscured center of a named card.
    const hit = await page.evaluate(() => {
      const ring = document.querySelector('[aria-label="半圆环牌堆"]').getBoundingClientRect();
      const x = ring.left + ring.width / 2;
      const y = ring.top + ring.width * 0.17;
      const target = document.elementFromPoint(x, y)?.closest('[data-deck-index]');
      return target ? { x, y, index: Number(target.getAttribute('data-deck-index')) } : null;
    });
    if (hit) {
      if (viewport.width < 500) await page.touchscreen.tap(hit.x, hit.y);
      else await page.mouse.click(hit.x, hit.y);
      assert.equal(
        await page.locator(`[data-deck-index="${hit.index}"]`).getAttribute('aria-pressed'),
        'true',
      );
    }
    const deck = page.getByRole('region', { name: '半圆环牌堆' });
    const input = viewport.width < 500 ? await context.newCDPSession(page) : null;
    const previewBeforeZoom = await deck
      .locator('[aria-pressed="true"]')
      .getAttribute('data-deck-index');
    if (input) await pinchDeck(deck, input, 2);
    else {
      await deck.focus();
      for (let i = 0; i < 4; i++) await page.keyboard.press('+');
    }
    assert.equal(await deck.evaluate((el) => el.style.width), '200%');
    assert.equal(
      await deck.locator('[aria-pressed="true"]').getAttribute('data-deck-index'),
      previewBeforeZoom,
      '缩放保留之前的预选牌',
    );
    const zoomView = await deck.evaluate((el) => {
      const view = el.parentElement;
      return {
        left: view.scrollLeft,
        width: view.clientWidth,
        deckWidth: el.clientWidth,
        preview: el.querySelector('[aria-pressed="true"]')?.getAttribute('data-deck-index'),
      };
    });
    assert(Math.abs(zoomView.deckWidth / dimensions.deckWidth - 2) < 0.02);
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      '放大仅扩展牌堆视窗内容，页面不横向溢出',
    );
    if (input) {
      await pinchDeck(deck, input, 2, true);
      assert.equal(
        await deck.locator('[aria-pressed="true"]').getAttribute('data-deck-index'),
        zoomView.preview,
      );
      assert(
        (await deck.evaluate((el) => el.parentElement.scrollLeft)) > zoomView.left,
        '固定双指距离平移应移动放大后的视野',
      );

      // Move along the rendered arc after zoom: a single finger still browses cards.
      await choose(page, 38);
      await deck.focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() =>
        [...document.querySelectorAll('[data-deck-index]')].every(
          (el) => el.getAnimations().length === 0,
        ),
      );
      const arc = await activeGeometry(deck);
      const beforeBrowse = await deck.evaluate((el) => ({
        left: el.parentElement.scrollLeft,
        top: el.parentElement.scrollTop,
      }));
      const radius = Math.hypot(arc.x - arc.cx, arc.y - arc.cy);
      const angle = Math.atan2(arc.x - arc.cx, arc.cy - arc.y);
      await touchGesture(
        input,
        Array.from({ length: 13 }, (_, step) => [
          {
            x: arc.cx + radius * Math.sin(angle + step * 0.01),
            y: arc.cy - radius * Math.cos(angle + step * 0.01),
          },
        ]),
      );
      assert.notEqual(
        await deck.locator('[aria-pressed="true"]').getAttribute('data-deck-index'),
        arc.index,
        '放大后单指沿弧仍能改变预选牌',
      );
      assert.deepEqual(
        await deck.evaluate((el) => ({
          left: el.parentElement.scrollLeft,
          top: el.parentElement.scrollTop,
        })),
        beforeBrowse,
        '单指拨牌时整体视野稳定',
      );
      assert.equal(await deck.locator('button:disabled').count(), 0, '沿弧拨牌不应自动抽取');
      await pinchDeck(deck, input, 1);
      await pinchDeck(deck, input, 0.75);
      await pinchDeck(deck, input, 1.25);
    } else {
      await page.keyboard.press('0');
      assert.equal(await deck.evaluate((el) => el.style.width), '100%');
      await page.keyboard.press('-');
      assert.equal(await deck.evaluate((el) => el.style.width), '75%');
      await page.keyboard.press('0');
      await page.keyboard.press('+');
    }
    assert(Math.abs((await deck.evaluate((el) => parseFloat(el.style.width))) - 125) < 1);
    const enlargedHit = await deck.evaluate((el) => {
      const view = el.parentElement.getBoundingClientRect();
      for (let y = view.top + 8; y < view.bottom - 8; y += 8) {
        for (let x = view.left + 8; x < view.right - 8; x += 8) {
          const target = document.elementFromPoint(x, y)?.closest('[data-deck-index]');
          if (target && !target.disabled && target.getAttribute('aria-pressed') !== 'true')
            return { x, y, index: target.getAttribute('data-deck-index') };
        }
      }
      return null;
    });
    assert(enlargedHit, '放大后有可触摸的卡牌');
    if (viewport.width < 500) await page.touchscreen.tap(enlargedHit.x, enlargedHit.y);
    else await page.mouse.click(enlargedHit.x, enlargedHit.y);
    assert.equal(
      await deck.locator('[aria-pressed="true"]').getAttribute('data-deck-index'),
      enlargedHit.index,
    );
    await deck.focus();
    await page.keyboard.press('End');
    await page.waitForFunction(
      () =>
        document.querySelector('[data-deck-index="77"]').getAttribute('aria-pressed') === 'true',
    );
    await page.waitForFunction(
      () => document.querySelector('[data-deck-index="77"]').getAnimations().length === 0,
    );
    const endVisible = await deck.evaluate((el) => {
      const rect = el.querySelector('[data-deck-index="77"]').getBoundingClientRect();
      const view = el.parentElement.getBoundingClientRect();
      return (
        rect.left >= view.left - 1 &&
        rect.right <= view.right + 1 &&
        rect.top >= view.top - 1 &&
        rect.bottom <= view.bottom + 1
      );
    });
    assert(endVisible, '键盘选到末张时应带入缩放视窗');
    await page.keyboard.press('Home');
    await page.waitForFunction(
      () => document.querySelector('[data-deck-index="0"]').getAttribute('aria-pressed') === 'true',
    );
    await page.waitForFunction(
      () => document.querySelector('[data-deck-index="0"]').getAnimations().length === 0,
    );
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          let frames = 0;
          const settle = () => {
            if (++frames >= 8) resolve();
            else requestAnimationFrame(settle);
          };
          requestAnimationFrame(settle);
        }),
    );
    const startVisible = await deck.evaluate((el) => {
      const rect = el.querySelector('[data-deck-index="0"]').getBoundingClientRect();
      const view = el.parentElement.getBoundingClientRect();
      return {
        left: rect.left - view.left,
        right: view.right - rect.right,
        top: rect.top - view.top,
        bottom: view.bottom - rect.bottom,
        scrollTop: el.parentElement.scrollTop,
      };
    });
    assert(
      Object.entries(startVisible).every(([key, value]) => key === 'scrollTop' || value >= -1),
      `首张应完整可见: ${JSON.stringify(startVisible)}`,
    );
    if (screenshots) await page.screenshot({ path: path.join(output, `${captureName}-zoom.png`) });
    const afterCapture = await deck.evaluate((el) => {
      const rect = el.querySelector('[data-deck-index="0"]').getBoundingClientRect();
      const view = el.parentElement.getBoundingClientRect();
      return {
        bottom: view.bottom - rect.bottom,
        scrollTop: el.parentElement.scrollTop,
        stage: el.getBoundingClientRect().toJSON(),
        view: view.toJSON(),
      };
    });
    assert(
      afterCapture.bottom >= -1,
      `截图后首张仍应完整可见: ${JSON.stringify({ startVisible, afterCapture })}`,
    );
    const first = await page.locator('[data-deck-index="0"]').boundingBox();
    const ring = await page.getByRole('region', { name: '半圆环牌堆' }).boundingBox();
    assert(first.x + first.width / 2 < ring.x + ring.width / 4, '首张预选不应居中');
    if (screenshots)
      await page.screenshot({ path: path.join(output, `${captureName}-preview.png`) });
    await extract(page);
    if (count > 1) {
      assert.equal(await page.locator('[data-deck-index="0"]').isDisabled(), true);
      assert.equal(
        await page.getByRole('button', { name: '返回调整', exact: true }).count(),
        0,
        '未选齐保持抽牌阶段',
      );
    }
    for (let i = 1; i < count; i++) {
      await choose(page, i === count - 1 ? 77 : 35 + i);
      await extract(page);
      if (i < count - 1)
        assert.equal(await page.getByRole('button', { name: '返回调整', exact: true }).count(), 0);
    }
    await page.getByRole('button', { name: '揭牌更多操作', exact: true }).waitFor();
    assert.equal(
      await page.getByRole('region', { name: '半圆环牌堆' }).count(),
      0,
      '抽齐后自动进入揭牌',
    );
    assert.equal(savedReadings.length, 0, '选齐但尚未揭牌时不保存');
    assert(
      await page.getByRole('button', { name: /，点击揭牌$/ }).isVisible(),
      '自动进入后仍待逐张揭牌',
    );
    if (screenshots)
      await page.screenshot({
        path: path.join(output, `${captureName}-reveal.png`),
        fullPage: true,
      });
    await (await revealAction(page, '返回调整')).click();
    await page.getByRole('button', { name: '返回揭牌', exact: true }).waitFor();
    assert.equal(
      await page.getByRole('button', { name: '返回调整', exact: true }).count(),
      0,
      '返回满额牌堆不会立即自动跳回',
    );
    assert.equal(await deck.locator('button:disabled').count(), 78, '满额时牌堆不再接受抽取');
    await page.getByRole('button', { name: '返回揭牌', exact: true }).click();
    await (await revealAction(page, '返回调整')).click();
    const lastIndex = count === 1 ? 0 : 77;
    await (await drawAction(page, '撤回上一张')).click();
    assert.equal(
      await page.locator(`[data-deck-index="${lastIndex}"]`).isDisabled(),
      false,
      '撤回归还最后抽取的原牌',
    );
    assert.equal(await deck.locator('button:disabled').count(), count - 1, '撤回仅影响最后一张');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await choose(page, lastIndex);
    await extract(page);
    await page.getByRole('button', { name: '揭牌更多操作', exact: true }).waitFor();
    assert.equal(savedReadings.length, 0, '撤回补选不提前保存');
    const saved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/readings' &&
        response.request().method() === 'POST',
    );
    await (await revealAction(page, '全部揭牌')).click();
    await saved;
    assert.equal(savedReadings.length, 1, '最终牌面在首次揭牌时只保存一次');
    assert.equal(savedReadings[0].drawnCards.length, count);
    assert.equal(await page.getByRole('button', { name: /解读这些牌/ }).isEnabled(), true);
    if (input) {
      // Keep gesture extraction separate from the existing first-card/undo/save regression.
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await openDraw(page, '三张牌阵');
      await choose(page, 38);
      const selected = await activeGeometry(deck);
      const pullFrames = (distance) =>
        Array.from({ length: 9 }, (_, step) => [
          {
            x: selected.x + (selected.nx * distance * step) / 8,
            y: selected.y + (selected.ny * distance * step) / 8,
          },
        ]);
      await touchGesture(input, pullFrames(22), async () => {
        await page.locator('[data-draw-pull]').waitFor({ state: 'attached' });
        assert.match(await page.locator('#fan-instructions').textContent(), /继续向外拖出/);
      });
      assert.equal(
        await deck.locator('button:disabled').count(),
        0,
        '短距离外拖松手应回到牌堆，不提交',
      );
      assert.equal(await page.locator('[data-draw-pull]').count(), 0);
      assert.equal(
        await deck.locator('[aria-pressed="true"]').getAttribute('data-deck-index'),
        selected.index,
      );
      await page.waitForFunction(() =>
        [...document.querySelectorAll('[data-deck-index]')].every(
          (el) => el.getAnimations().length === 0,
        ),
      );
      await touchGesture(input, pullFrames(65), async () => {
        assert.match(await page.locator('#fan-instructions').textContent(), /松手抽取这张/);
        assert.equal(
          await deck.locator('button:disabled').count(),
          0,
          '达到抽取距离但尚未松手时不提交',
        );
      });
      await page.waitForFunction(
        (index) =>
          document
            .querySelector(`[data-deck-index="${index}"]`)
            ?.getAttribute('aria-label')
            ?.includes('已抽取'),
        selected.index,
      );
      assert.equal(
        await deck.getByRole('button', { name: /已抽取/ }).count(),
        1,
        '径向拖出释放应只抽取当前牌',
      );
      assert.match(
        await deck.locator(`[data-deck-index="${selected.index}"]`).getAttribute('aria-label'),
        /已抽取/,
      );
      assert.equal(savedReadings.length, 1, '仅抽牌未揭牌时不增加保存请求');
      await input.detach();
    }
    results.push({ viewport, cards: count, dimensions, pointerHit: hit?.index, status: 'passed' });
    await context.close();
    activePage = null;
  }
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, 'results.json'),
    JSON.stringify(
      {
        results,
        errors,
        limitation: '隔离浏览器与模拟会话；未验证 iOS/Android 微信真机或实际模型。',
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ cases: results.length, errors }));
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({
      path: path.join(output, `${activeCapture}-failure.png`),
      fullPage: true,
    });
    console.error(await activePage.locator('body').innerText());
  }
  throw error;
} finally {
  await browser.close();
}
