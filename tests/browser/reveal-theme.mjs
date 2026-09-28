import { revealAction, revealNext } from './reveal-actions.mjs';
// Isolated browser acceptance. Supply the local site URL and evidence directory.
// Account, card assets, persistence and model responses never use real services.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [baseUrl, output] = process.argv.slice(2);
if (!baseUrl || !output) throw new Error('需要本地站点 URL 与证据输出目录');
const motion = process.argv.includes('--motion');
const stress = process.argv.includes('--stress');
const baseline = process.argv.includes('--baseline');
const primary = process.argv.includes('--primary') || baseline || motion;
const viewports = process.argv.includes('--desktop')
  ? [{ width: 1440, height: 1000 }]
  : stress
    ? [
        { width: 320, height: 740 },
        { width: 390, height: 844 },
      ]
    : primary
      ? [{ width: 390, height: 844 }]
      : [
          { width: 390, height: 844 },
          { width: 320, height: 740 },
          { width: 360, height: 800 },
          { width: 390, height: 659 },
          { width: 430, height: 932 },
          { width: 1440, height: 1000 },
        ];
const spreads = motion
  ? [['三张牌阵', 3]]
  : stress
    ? [
        ['三张牌阵', 3],
        ['凯尔特十字', 10],
      ]
    : primary
      ? [
          ['三张牌阵', 3],
          ['凯尔特十字', 10],
        ]
      : [
          ['单张牌', 1],
          ['三张牌阵', 3],
          ['二择一', 5],
          ['关系牌阵', 5],
          ['时间之流', 5],
          ['凯尔特十字', 10],
        ];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  channel: process.env.BROWSER_CHANNEL || undefined,
});
const results = [];
let page;
try {
  for (const viewport of viewports)
    for (const [spreadName, count] of spreads) {
      const context = await browser.newContext({
        viewport,
        hasTouch: viewport.width < 500,
        reducedMotion: motion ? 'no-preference' : 'reduce',
      });
      // Deterministic TEST deck: preserve order, Fool upright, Magician reversed, Star upright.
      const saves = [];
      const requests = [];
      const errors = [];
      const interpretations = [];
      const unavailable = stress && viewport.width === 320;
      await context.route('**/api/**', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/api/auth/me')
          return route.fulfill({ json: { user: { nickname: '揭牌验收', avatarUrl: '' } } });
        if (url.pathname === '/api/config')
          return route.fulfill({ json: { available: !unavailable } });
        if (url.pathname === '/api/agent-session')
          return route.fulfill({ json: { tasks: [], revision: 0 } });
        if (url.pathname === '/api/interpret/config')
          return route.fulfill({
            json: {
              connectTimeoutMs: 15000,
              streamIdleTimeoutMs: 15000,
              progressTimeoutMs: 15000,
              totalTimeoutMs: 30000,
              maxRetries: 0,
              retryBaseMs: 1000,
            },
          });
        if (url.pathname.startsWith('/api/readings')) {
          requests.push([route.request().method(), url.pathname]);
          if (route.request().method() === 'POST') saves.push(route.request().postDataJSON());
          return route.fulfill({ json: route.request().method() === 'GET' ? [] : { ok: true } });
        }
        if (url.pathname === '/api/interpret') {
          interpretations.push(route.request().postDataJSON());
          return route.fulfill({
            contentType: 'text/event-stream',
            body: 'data: {"content":"隔离测试：保留既有解读流程。"}\n\ndata: [DONE]\n\n',
          });
        }
        throw new Error(`意外接口请求：${route.request().method()} ${url.pathname}`);
      });
      await context.route('**/cards/**', async (route) => {
        if (new URL(route.request().url()).searchParams.has('reveal-test-failure'))
          return route.fulfill({ status: 404 });
        const relative = new URL(route.request().url()).pathname.replace(/^\//, '');
        return route.fulfill({
          body: await readFile(path.join(process.cwd(), 'public', relative)),
          contentType: 'image/jpeg',
        });
      });
      page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on('pageerror', (e) => errors.push(e.message));
      const prefix = `${viewport.width}x${viewport.height}-${count}-${spreadName}`;
      const capture = async (state) => {
        await page.evaluate(() => window.scrollTo(0, 0));
        if (motion)
          await page.locator('[data-reveal-card]').evaluateAll((els) =>
            Promise.all(
              els
                .flatMap((el) => el.getAnimations({ subtree: true }))
                .filter((a) => a.effect.getComputedTiming().iterations !== Infinity)
                .map((a) => a.finished.catch(() => {})),
            ),
          );
        await page.screenshot({
          path: path.join(output, `${prefix}-${state}.png`),
          fullPage: true,
        });
      };
      await page.goto(new URL('/reading', baseUrl).href, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle');
      await page
        .getByRole('textbox', { name: '写下你的问题', exact: true })
        .fill(
          stress
            ? '我希望更清楚地理解自己的表达习惯，与伙伴合作时应该如何调整？'.repeat(3) +
                'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(4) +
                '龘𠮷🙂'
            : '我可以如何更清楚地表达自己的想法？',
        );
      await page.getByRole('button', { name: '下一步，选择牌阵' }).click();
      const selected = page.getByRole('button', { name: new RegExp(spreadName), pressed: true });
      for (let n = 0; !(await selected.count()) && n < 6; n++) {
        await page.getByRole('region', { name: '选择牌阵', exact: true }).press('ArrowRight');
        await page.waitForFunction(
          () =>
            document.querySelector('[aria-roledescription="轮播"]')?.getAttribute('data-phase') ===
            'idle',
        );
      }
      assert.equal(await selected.count(), 1, `选中 ${spreadName}`);
      await page.waitForFunction(
        () =>
          document.querySelector('[aria-roledescription="轮播"]')?.getAttribute('data-phase') ===
          'idle',
      );
      await page.getByRole('button', { pressed: true }).click();
      await page.evaluate(() => {
        let calls = 0;
        Math.random = () => {
          const n = calls++;
          return n < 77 ? 0.999999 : n === 78 ? 0.9 : 0.1;
        };
      });
      await page.getByRole('button', { name: '点击牌堆洗牌', exact: true }).click();
      if (motion)
        await page.waitForFunction(
          () =>
            document.querySelector('[data-shuffle-state]')?.getAttribute('data-shuffle-state') ===
            'ready',
        );
      await page.getByRole('button', { name: '开始抽牌', exact: true }).click();
      await page.getByRole('region', { name: '半圆环牌堆' }).waitFor();
      const indexes =
        stress && count === 3
          ? [73, 75, 76]
          : count === 3
            ? [0, 1, 17]
            : Array.from({ length: count }, (_, n) => n);
      for (const i of indexes) {
        await page.locator(`[data-deck-index="${i}"]`).focus();
        await page.keyboard.press('Enter');
        await page.locator('[data-deck-index][aria-pressed="true"]').press('Enter');
        await page.locator('[data-draw-flight]').waitFor({ state: 'hidden' });
      }
      await page.getByRole('button', { name: '揭牌更多操作', exact: true }).waitFor();
      if (stress) {
        await (await revealAction(page, '返回调整')).click();
        await page.getByRole('button', { name: '返回揭牌', exact: true }).click();
        assert.equal(saves.length, 0, '返回调整不保存');
        if (viewport.width === 390)
          await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
      }
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.equal(saves.length, 0, '未揭牌不保存');
      await capture('unrevealed');
      assert.equal(await page.getByRole('button', { name: '揭开下一张', exact: true }).count(), 0);
      await revealAction(page, '全部揭牌');
      const menuBox = await page.getByRole('menu', { name: '揭牌操作' }).boundingBox();
      assert(menuBox.x >= 0 && menuBox.x + menuBox.width <= viewport.width, '更多菜单不横向越界');
      await capture('menu');
      await page.keyboard.press('Escape');
      if (stress) {
        const targets = await page
          .getByRole('region', { name: '揭牌', exact: true })
          .locator('button:not(:disabled), [role=button]:not([aria-disabled=true])')
          .evaluateAll((els) =>
            els.map((el) => ({
              text: el.getAttribute('aria-label') || el.textContent,
              w: el.getBoundingClientRect().width,
              h: el.getBoundingClientRect().height,
            })),
          );
        assert.deepEqual(
          targets.filter((t) => t.w < 44 || t.h < 44),
          [],
          '可操作目标至少44px',
        );
      }
      const before = baseline
        ? []
        : await page.locator('[data-reveal-card]').evaluateAll((els) =>
            els.map((el) => {
              const r = el.getBoundingClientRect();
              return { x: r.x, y: r.y + scrollY };
            }),
          );
      await revealNext(page, viewport.width < 500);
      if (count > 1) {
        await revealAction(page, '全部揭牌');
        assert.equal(
          await page.getByRole('menuitem', { name: '返回调整', exact: true }).count(),
          0,
          '揭牌后不能返回调整',
        );
        await page.keyboard.press('Escape');
      }
      await capture('partial');
      if (stress && count === 10) {
        for (let n = 1; n < 9; n++) await revealNext(page, viewport.width < 500);
        await capture('nine');
        await page.getByRole('button', { name: '按位置查看', exact: true }).click();
        assert.equal(await page.getByText('已揭 9 / 10', { exact: true }).count(), 1);
        await page.getByRole('button', { name: '牌阵图', exact: true }).click();
        await page.getByRole('button', { name: /，点击揭牌$/ }).dblclick();
        assert.equal(interpretations.length, 0, '最后一张连击不会自动解读');
      }
      if (count > 1 && !(stress && count === 10)) {
        await (await revealAction(page, '全部揭牌')).focus();
        await page.keyboard.press('Enter');
      }
      await page.getByRole('button', { name: /解读这些牌/ }).waitFor();
      if (stress) {
        await page
          .locator('[data-reveal-card]')
          .first()
          .locator('img:not([alt=""])')
          .evaluate((img) => {
            const url = new URL(img.src);
            url.searchParams.set('reveal-test-failure', '1');
            img.src = url.href;
          });
      }
      if (stress) {
        const retry = page.getByRole('button', { name: '重试加载牌面', exact: true });
        await retry.waitFor();
        assert.equal(await retry.count(), 1, '牌面请求失败出现重试入口');
        if (await retry.count()) {
          await capture('image-failure');
          await retry.first().click();
          await page.waitForFunction(() =>
            [...document.images].every((i) => i.complete && i.naturalWidth > 0),
          );
        }
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await capture('complete');
      const dimensions = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        brokenImages: [...document.images]
          .filter((i) => !i.complete || i.naturalWidth === 0)
          .map((i) => i.getAttribute('src')),
        cards: [...document.querySelectorAll('[data-reveal-card]')].map((el) => {
          const rect = el.getBoundingClientRect();
          return { ...rect.toJSON(), y: rect.y + scrollY };
        }),
      }));
      if (!baseline) {
        assert(dimensions.scrollWidth <= viewport.width, '无横向溢出');
        assert.deepEqual(dimensions.brokenImages, [], '图片全部加载');
        if (count !== 10) {
          assert.equal(dimensions.cards.length, count);
        }
        for (let i = 0; i < before.length; i++) {
          assert(
            Math.abs(dimensions.cards[i].y - before[i].y) < 1,
            `牌名出现不移动牌位 ${i + 1}: ${before[i].y} -> ${dimensions.cards[i].y}`,
          );
        }
        assert.equal(saves.length, 1, '首次揭牌只保存一次');
        assert.equal(
          await page.getByRole('button', { name: /解读这些牌/ }).isEnabled(),
          !unavailable,
        );
        assert.equal(interpretations.length, 0, '全揭不自动解读');
      }
      if (count === 10) {
        await page.getByRole('button', { name: '按位置查看', exact: true }).click();
        await capture('positions');
        assert.equal(await page.getByRole('list').last().getByRole('button').count(), 10);
        await page.getByRole('list').last().getByRole('button').first().click();
        await page.getByRole('region', { name: '位置详情' }).waitFor();
        await capture('detail');
      }
      if (stress) {
        await (await revealAction(page, '重新抽牌')).click();
        await page.getByRole('dialog').waitFor();
        await page.keyboard.press('Escape');
        assert.equal(await page.getByText(`已揭 ${count} / ${count}`, { exact: true }).count(), 1);
      }
      if (!unavailable) {
        await page.getByRole('button', { name: '解读这些牌', exact: true }).click();
        await page.getByText('隔离测试：保留既有解读流程。', { exact: true }).waitFor();
        const cardsToggle = page.locator('summary').filter({ hasText: '收起牌面' });
        const cardsPanel = page
          .locator('details')
          .filter({ has: page.locator('summary').filter({ hasText: '牌面' }) });
        assert.equal(await cardsPanel.getAttribute('open'), '', '解读页默认展开牌面');
        await cardsToggle.click();
        await page.locator('summary').filter({ hasText: '展开牌面' }).waitFor();
        assert.equal(await cardsPanel.getAttribute('open'), null, '用户可以收起牌面');
        await page.locator('summary').filter({ hasText: '展开牌面' }).click();
        await cardsToggle.waitFor();
        assert.equal(interpretations.length, 1, '用户主动发起一次解读');
        await capture('interpretation');
      } else if (stress) {
        await (await revealAction(page, '重新抽牌')).click();
        await page.getByRole('button', { name: '确认重新抽牌', exact: true }).click();
        await page.getByRole('button', { name: '点击牌堆洗牌', exact: true }).waitFor();
      }
      assert.deepEqual(errors, [], '没有页面异常');
      results.push({
        viewport,
        spreadName,
        count,
        saves: saves.length,
        requests,
        dimensions,
        errors,
        interpretations: interpretations.length,
        unavailable,
        stress,
        motion,
      });
      console.log(`PASS ${prefix}`);
      await context.close();
    }
} catch (error) {
  if (page && !page.isClosed())
    await page
      .screenshot({ path: path.join(output, 'failure.png'), fullPage: true })
      .catch(() => {});
  throw error;
} finally {
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
}
