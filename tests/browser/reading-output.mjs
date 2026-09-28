import { revealAction } from './reveal-actions.mjs';
// 浏览器验收专用：隔离会话、内存记录与模拟 SSE；不访问真实账户或模型。
// NODE_PATH 指向含 playwright 的运行时；BROWSER_CHANNEL 由执行环境选择。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const baseUrl = process.argv[2];
if (!baseUrl || !['http:', 'https:'].includes(new URL(baseUrl).protocol))
  throw new Error('请传入测试站点 URL');
const output = path.resolve(process.argv[3] ?? 'docs/tasks/reading-output-browser');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  channel: process.env.BROWSER_CHANNEL || undefined,
});
const errors = [];
const results = [];

try {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 320, height: 740 },
    { width: 375, height: 812 },
    { width: 430, height: 932 },
    { width: 1440, height: 900 },
  ]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const records = new Map();
    await context.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      let data = {};
      if (url.pathname === '/api/auth/me')
        data = {
          user: {
            nickname: '浏览器测试用户',
            avatarUrl: '',
            createdAt: '2026-09-10T00:00:00.000Z',
          },
        };
      else if (url.pathname === '/api/config') data = { available: true };
      else if (url.pathname === '/api/readings') {
        if (request.method() === 'POST') {
          const record = request.postDataJSON();
          records.set(record.id, record);
        }
        data = { readings: [...records.values()], hasMore: false };
      } else if (url.pathname.startsWith('/api/readings/')) {
        const id = url.pathname.split('/').at(-1);
        if (request.method() === 'PATCH')
          records.set(id, { ...records.get(id), ...request.postDataJSON() });
        data = { reading: records.get(id) };
      } else if (url.pathname.startsWith('/api/assets/')) return route.continue();
      else throw new Error(`未定义的测试 API：${url.pathname}`);
      await route.fulfill({ json: data });
    });
    await context.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      const records = [];
      window.readingOutputTestRequests = records;
      window.fetch = async (input, init) => {
        const url = new URL(String(input), window.location.origin);
        if (url.pathname !== '/api/interpret') return originalFetch(input, init);
        const body = JSON.parse(String(init.body));
        records.push(body);
        const prompt = body.agent?.prompt ?? '';
        const choose = prompt.includes('## 可选牌阵');
        const decide = prompt.includes('## 请判断') || body.followUp?.mode === 'decide';
        const content = choose
          ? '{"spreadId":"three-card","reason":"测试牌阵"}'
          : decide
            ? '{"decision":"direct","drawCount":0,"reason":"已有背景足够"}'
            : '## 核心解读\n你已经约好周五见面，可以先想清楚这次最希望了解的一件事。一次见面不必承担确定整段关系的压力。\n\n你可以留意双方是否愿意交流，而不急着从一句话判断结果。\n## 可采取的行动\n先选一个双方都方便聊的时机，说说你最近的感受，也留一点空间听对方怎么回应。这样更容易看清你们能否把话接下去。\n## 各牌说明\n' +
              Array.from(
                { length: 10 },
                (_, i) =>
                  `### 测试牌位 ${i + 1}\n这是浏览器测试使用的专业说明，验证长内容的展开和滚动，不代表真实模型结果。\n\n`,
              ).join('');
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            const send = (delta) =>
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`),
              );
            if (!choose && !decide) send({ reasoning_content: '浏览器测试的独立思考内容。' });
            for (let i = 0; i < content.length; i += 24) {
              if (init.signal?.aborted) {
                controller.error(new DOMException('Aborted', 'AbortError'));
                return;
              }
              send({ content: content.slice(i, i + 24) });
              await new Promise((resolve) => setTimeout(resolve, choose || decide ? 0 : 60));
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          },
        });
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
      };
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(new URL('/', baseUrl).href);
    const mainEntry = page.getByRole('link', { name: /说说正在困扰你的事/ });
    const manualEntry = page.getByRole('link', { name: '自己选择牌阵', exact: true });
    for (const entry of [mainEntry, manualEntry]) {
      const box = await entry.boundingBox();
      assert.ok(box && box.y >= 0 && box.y + box.height < viewport.height, '首页主次入口在首屏');
      assert.ok(
        await entry.evaluate((node) => node.scrollWidth <= node.clientWidth),
        '入口文字完整不被裁切',
      );
    }
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      '首页无横向溢出',
    );
    await page.screenshot({ path: path.join(output, `${viewport.width}-home.png`) });
    await mainEntry.click();
    await page.getByText('示例问题 · 先填草稿再修改', { exact: true }).click();
    await page.getByRole('button', { name: '面对眼前的选择，我该如何决定？', exact: true }).click();
    await page.getByRole('button', { name: '焦虑', exact: true }).click();
    const draft = page.getByRole('textbox', { name: '探索问题或追问' });
    assert.ok((await draft.inputValue()).includes('我现在感到焦虑。'));
    assert.equal(
      await page.evaluate(() => window.readingOutputTestRequests.length),
      0,
      '示例与感受不自动发送',
    );
    await page.screenshot({ path: path.join(output, `${viewport.width}-draft.png`) });
    await page
      .getByRole('textbox', { name: '探索问题或追问' })
      .fill('我们已约好周五见面，我该怎么开口？');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const professional = page
      .locator('details')
      .filter({ has: page.getByText('牌义依据', { exact: true }) });
    await professional.waitFor();
    assert.equal(await professional.getAttribute('open'), null);
    assert.equal(await page.getByText('测试牌位 1', { exact: true }).count(), 0);
    await page.getByText('可以怎么做', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `${viewport.width}-collapsed.png`) });
    const beforeExpandRequests = await page.evaluate(() => window.readingOutputTestRequests.length);
    await professional.locator('summary').click();
    await page.getByRole('heading', { name: '测试牌位 1', exact: true }).waitFor();
    const top = await page.evaluate(() => window.scrollY);
    await page.waitForTimeout(350);
    assert.ok(
      Math.abs((await page.evaluate(() => window.scrollY)) - top) < 5,
      '展开后流式增长不抢滚动',
    );
    await page.getByRole('button', { name: '发送', exact: true }).waitFor();
    assert.notEqual(await professional.getAttribute('open'), null, '完成后保持展开');
    assert.equal(
      await page.evaluate(() => window.readingOutputTestRequests.length),
      beforeExpandRequests,
      '展开不调用模型',
    );
    await page.screenshot({ path: path.join(output, `${viewport.width}-expanded.png`) });
    await professional.locator('summary').click();
    const thinking = page
      .locator('details')
      .filter({ has: page.getByText('模型思考', { exact: true }) });
    assert.equal(await thinking.count(), 0, '完成后隐藏模型思考');
    await professional.locator('summary').focus();
    await page.keyboard.press('Enter');
    assert.notEqual(await professional.getAttribute('open'), null, '键盘可展开');
    await page.keyboard.press('Space');
    assert.equal(await professional.getAttribute('open'), null, '键盘可收起');
    await page.getByRole('button', { name: /回到最新/ }).click();
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      '无横向溢出',
    );
    await page
      .getByRole('textbox', { name: '探索问题或追问' })
      .fill('我已经想好要说什么了，怎么留空间听对方回应？');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByRole('button', { name: '发送', exact: true }).waitFor();
    assert.equal(await page.getByText('牌义依据', { exact: true }).count(), 2, '追问复用分层');
    const id = [...records.keys()][0];
    assert.ok(id, '已完成记录保存在测试内存');
    await page.goto(new URL(`/history/${id}`, baseUrl).href);
    await page.getByText('牌义依据', { exact: true }).first().waitFor();
    assert.equal(await page.locator('details[open]').count(), 0, '历史默认折叠');
    await page.getByRole('link', { name: '继续聊这件事', exact: true }).click();
    await page.getByRole('button', { name: '更新进展', exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() => window.readingOutputTestRequests.length),
      0,
      '恢复不请求模型',
    );
    const oldFollowUps = records.get(id).followUps.length;
    await page.getByRole('button', { name: '更新进展', exact: true }).click();
    assert.ok((await draft.inputValue()).includes('这件事有了新的进展：'));
    assert.equal(
      await page.evaluate(() => window.readingOutputTestRequests.length),
      0,
      '进展先填草稿',
    );
    await draft.fill('我已经尝试沟通，对方愿意听，但还没有决定下一次见面。');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByRole('button', { name: '发送', exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() => window.readingOutputTestRequests.length),
      1,
      '进展追问直接回应，不补牌',
    );
    assert.equal(records.get(id).followUps.length, oldFollowUps + 1, '更新同一记录');
    await page.reload();
    await page
      .getByText('我已经尝试沟通，对方愿意听，但还没有决定下一次见面。', { exact: true })
      .waitFor();
    await page.screenshot({ path: path.join(output, `${viewport.width}-resumed.png`) });
    assert.equal(
      await page.evaluate(() => window.readingOutputTestRequests.length),
      0,
      '刷新恢复没有重复发送',
    );
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      '历史续聊无横向溢出',
    );
    if (viewport.width === 390) {
      await page.goto(new URL('/reading', baseUrl).href);
      await page
        .getByRole('textbox', { name: '写下你的问题', exact: true })
        .fill('我们已约好周五见面，我该怎么开口？');
      await page.getByRole('button', { name: /带 着 问 题 前 行/ }).click();
      await page.getByRole('button', { name: /单张牌/ }).click();
      await page.waitForFunction(
        () =>
          document.querySelector('[aria-roledescription="轮播"]')?.getAttribute('data-phase') ===
          'idle',
      );
      await page.getByRole('button', { pressed: true }).click();
      await page.getByRole('button', { name: '点击牌堆洗牌', exact: true }).click();
      await page.getByRole('button', { name: '开始抽牌', exact: true }).click();
      // 扇形牌堆彼此重叠，沿用 fan-draw 验收的键盘选牌路径。
      await page.getByRole('button', { name: '牌堆第 1 张，未翻开', exact: true }).focus();
      await page.keyboard.press('Enter');
      await page.locator('[data-deck-index][aria-pressed="true"]').press('Enter');
      await (await revealAction(page, '全部揭牌')).click();
      await page.getByRole('button', { name: /解读这些牌/ }).click();
      await page.getByText('牌义依据', { exact: true }).waitFor();
      await page.getByRole('button', { name: '停止生成（保留已生成内容）', exact: true }).click();
      await page.getByRole('button', { name: /(?:重新|重试)解读（保留原牌）/ }).click();
      await page.getByRole('textbox', { name: '追问内容', exact: true }).waitFor();
      await page.getByText('事情怎么看', { exact: true }).scrollIntoViewIfNeeded();
      assert.equal(await page.locator('details[open]').count(), 0, '手动重生成默认折叠');
      await page.screenshot({ path: path.join(output, '390-manual.png') });
      const inputs = await page.evaluate(() =>
        window.readingOutputTestRequests.filter((request) => request.drawnCards),
      );
      assert.deepEqual(inputs[0].drawnCards, inputs[1].drawnCards, '停止后重试保留原牌');
      await page
        .getByRole('textbox', { name: '追问内容', exact: true })
        .fill('我已想好开场，怎么留空间听对方回应？');
      await page.getByRole('button', { name: /追 问/, exact: false }).last().click();
      await page.waitForFunction(() => document.querySelectorAll('details').length === 4);
      await page
        .getByRole('textbox', { name: '追问内容', exact: true })
        .waitFor({ state: 'visible' });
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        '手动结果无横向溢出',
      );
      results.push({
        viewport,
        flow: '手动占卜',
        checks: [
          '抽牌到解读',
          '中断保留内容',
          '保留原牌重试',
          '重生成折叠重置',
          '追问分层',
          '无横向溢出',
        ],
      });
    }
    results.push({
      viewport,
      checks: [
        '默认折叠',
        '流式展开后不抢滚动',
        '完成保持展开',
        '展开无请求',
        '键盘操作',
        '无横向溢出',
        '追问分层',
        '历史回看',
        '首页首屏入口',
        '示例感受草稿',
        '历史续聊与进展持久化',
      ],
    });
    await context.close();
  }
  assert.deepEqual(errors, [], '浏览器无脚本/console error');
} catch (error) {
  const active = browser.contexts().at(-1)?.pages().at(-1);
  if (active) await active.screenshot({ path: path.join(output, 'failure.png') });
  throw error;
} finally {
  await writeFile(
    path.join(output, 'results.json'),
    JSON.stringify({ mode: '真实浏览器，模拟 API/SSE，非微信真机', results, errors }, null, 2),
  );
  await browser.close();
}
console.log(`浏览器验证完成：${results.length} 组流程，${errors.length} 个浏览器错误。`);
