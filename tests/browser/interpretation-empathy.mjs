// 实页验收：所有身份、存储和模型请求由测试内存隔离；固定文本仅用于展示契约测试。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { revealAction } from './reveal-actions.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const [baseUrl, outputArg] = process.argv.slice(2);
if (!baseUrl || !outputArg || !['http:', 'https:'].includes(new URL(baseUrl).protocol))
  throw new Error('需要测试站点 URL 和输出目录');
const output = path.resolve(outputArg);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
const results = [],
  errors = [],
  requests = [];
const records = new Map(),
  daily = new Map();
let session = { tasks: [], revision: 0 },
  includeAction = false;
const core = '你已经说明不想复合，这次只讨论取回物品。';
const action = '先列出需要取回的物品，再确认双方方便的交接方式。';
const direct = '明白，你并不想恢复关系；我们把话题收回到物品交接。';
const dailyText =
  '这张牌提供一个观察角度。你可以看看今天是否有一件值得放慢判断的小事，不必预设一定会发生什么。';
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  reducedMotion: 'reduce',
});
await context.route('**/api/**', async (route) => {
  const request = route.request(),
    url = new URL(request.url()),
    method = request.method();
  let data;
  if (url.pathname === '/api/auth/me')
    data = { user: { nickname: 'TEST 共情验收', avatarUrl: '' } };
  else if (url.pathname === '/api/config') data = { available: true };
  else if (url.pathname === '/api/interpret/config')
    data = {
      connectTimeoutMs: 10000,
      streamIdleTimeoutMs: 10000,
      progressTimeoutMs: 10000,
      totalTimeoutMs: 30000,
      maxRetries: 0,
      retryBaseMs: 100,
    };
  else if (url.pathname === '/api/interpret') {
    const body = request.postDataJSON();
    requests.push(body);
    const prompt = body.agent?.prompt ?? '';
    const decide = body.followUp?.mode === 'decide' || prompt.includes('## 请判断');
    const cards = body.drawnCards ?? [];
    const cardDetails = cards
      .map(
        (drawn) =>
          `### ${drawn.position.nameCn} · ${drawn.card.nameCn}（${drawn.isReversed ? '逆位' : '正位'}）\n这是隔离测试的牌面说明。`,
      )
      .join('\n');
    const content = decide
      ? '{"decision":"direct","drawCount":0,"reason":"承接用户纠正"}'
      : body.daily
        ? dailyText
        : body.agent || body.followUp
          ? direct
          : `## 核心解读\n${core}\n${includeAction ? `## 可采取的行动\n${action}\n` : ''}## 各牌说明\n${cardDetails}`;
    if (body.daily)
      daily.set(body.daily.dateKey, {
        dateKey: body.daily.dateKey,
        note: '',
        updatedAt: null,
        interpretation: content,
        interpretationStatus: 'done',
      });
    // addInitScript 将此测试响应转换成逐块 SSE，实际业务后端不会收到请求。
    data = { content };
  } else if (url.pathname === '/api/readings') {
    if (method === 'POST') {
      const record = request.postDataJSON();
      records.set(record.id, record);
    }
    data = { readings: [...records.values()], hasMore: false };
  } else if (url.pathname.startsWith('/api/readings/')) {
    const id = url.pathname.split('/').at(-1);
    if (method === 'PATCH') records.set(id, { ...records.get(id), ...request.postDataJSON() });
    data = { reading: records.get(id) };
  } else if (url.pathname === '/api/agent-session') {
    if (method === 'PUT') session = { ...request.postDataJSON(), revision: session.revision + 1 };
    data = {
      ...session,
      tasks: session.tasks.map((task) => ({
        ...task,
        reading: records.get(task.readingId),
        completion: 'complete',
      })),
    };
  } else if (url.pathname === '/api/daily') data = { entries: [...daily.values()], hasMore: false };
  else if (url.pathname.startsWith('/api/daily/'))
    data = { entry: daily.get(url.pathname.split('/').at(-1)) ?? null };
  else if (url.pathname.startsWith('/api/assets/')) return route.continue();
  else {
    errors.push(`未定义的测试 API：${method} ${url.pathname}`);
    return route.abort();
  }
  await route.fulfill({ json: data });
});
await context.addInitScript(() => {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    if (new URL(String(input), location.origin).pathname !== '/api/interpret') return response;
    const { content } = await response.json();
    const encoder = new TextEncoder();
    let cancelled = false;
    return new Response(
      new ReadableStream({
        async start(controller) {
          const send = (data) => {
            if (!cancelled) controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          };
          for (let i = 0; i < content.length; i += 18) {
            if (cancelled) return;
            if (init.signal?.aborted) {
              controller.error(new DOMException('Aborted', 'AbortError'));
              return;
            }
            send({ choices: [{ delta: { content: content.slice(i, i + 18) } }] });
            await new Promise((resolve) => setTimeout(resolve, 30));
          }
          if (cancelled) return;
          send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
          send({ persistence: 'saved' });
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  };
});
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
const capture = (name) =>
  page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
try {
  await page.goto(new URL('/reading?spread=single', baseUrl).href);
  await page
    .getByRole('textbox', { name: '写下你的问题', exact: true })
    .fill('我不想复合，只想取回物品');
  await page.getByRole('button', { name: '使用此牌阵，开始洗牌', exact: true }).click();
  await page.getByRole('button', { name: '点击牌堆洗牌', exact: true }).click();
  await page.getByRole('button', { name: '开始抽牌', exact: true }).click();
  await page.getByRole('button', { name: '牌堆第 1 张，未翻开', exact: true }).press('Enter');
  await page.locator('[data-deck-index][aria-pressed="true"]').press('Enter');
  await (await revealAction(page, '全部揭牌')).click();
  await page.getByRole('button', { name: '解读这些牌', exact: true }).click();
  await page.getByRole('textbox', { name: '追问内容', exact: true }).waitFor();
  await page.getByText(core, { exact: true }).waitFor();
  assert.equal(
    await page.getByRole('tablist', { name: '解读章节' }).count(),
    0,
    '单章无空行动页签',
  );
  assert.equal(await page.getByText('本次解读 · 两个视角', { exact: true }).count(), 0);
  const professional = page
    .locator('details')
    .filter({ has: page.getByText('牌义依据', { exact: true }) });
  assert.equal(await professional.getAttribute('open'), null);
  await professional.locator('summary').click();
  await page.getByText('这是隔离测试的牌面说明。', { exact: true }).waitFor();
  await capture('manual-single-chapter');
  const id = [...records.keys()][0];
  assert(id);
  const originalCards = records.get(id).drawnCards;
  includeAction = true;
  await page.getByRole('button', { name: '重新解读（保留原牌）', exact: true }).click();
  await page.getByRole('tab', { name: /可以怎么做/ }).waitFor();
  await page.getByRole('textbox', { name: '追问内容', exact: true }).waitFor();
  await page.getByRole('tab', { name: /可以怎么做/ }).click();
  await page.getByText(action, { exact: true }).waitFor();
  assert.deepEqual(records.get(id).drawnCards, originalCards);
  assert.equal(await page.getByRole('tab').count(), 2);
  await capture('manual-two-chapters');
  results.push({
    flow: '手动抽牌、流式解读与重新生成',
    passed: true,
    checks: ['单章无空页签', '牌义折叠展开', '双章可切换', '原牌不变'],
  });

  await page.goto(new URL(`/history/${id}`, baseUrl).href);
  await page.getByText(core, { exact: true }).waitFor();
  await page.getByText(action, { exact: true }).waitFor();
  const callsBeforeRestore = requests.length;
  await page.getByRole('link', { name: '继续聊这件事', exact: true }).click();
  await page.getByRole('textbox', { name: '探索问题或追问' }).waitFor();
  assert.equal(await page.getByRole('button', { name: /辅助/ }).count(), 0);
  assert.equal(requests.length, callsBeforeRestore, '恢复原记录不调用模型');
  await page.getByRole('textbox', { name: '探索问题或追问' }).fill('我没有想复合，请只讨论交接');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByText(direct, { exact: true }).waitFor();
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="探索问题或追问"]')?.disabled,
  );
  assert.equal(requests.length, callsBeforeRestore + 2, '普通追问经过判断后回应纠正');
  assert.equal(records.get(id).followUps.length, 1);
  assert.equal(
    await page.getByText('牌义依据', { exact: true }).count(),
    1,
    '简答不附加空牌义章节',
  );
  await capture('agent-direct');
  await page.reload();
  await page.getByText(direct, { exact: true }).waitFor();
  assert.equal(requests.length, callsBeforeRestore + 2, '刷新保留追问且不重复生成');
  results.push({ flow: '旧三段历史、Agent 直接纠正、刷新恢复', passed: true });

  await page.goto(new URL('/daily', baseUrl).href);
  await page.getByRole('button', { name: /生 成 解 读/ }).click();
  await page.getByText(dailyText, { exact: true }).waitFor();
  const afterDaily = requests.length;
  await page.reload();
  await page.getByText(dailyText, { exact: true }).waitFor();
  assert.equal(requests.length, afterDaily, '每日已保存简答刷新不重新调用模型');
  await capture('daily-restored');
  results.push({ flow: '每日简短正文与保存后恢复', passed: true });
  assert.deepEqual(errors, [], '没有浏览器错误或未隔离业务请求');
} catch (error) {
  await capture('failure');
  throw error;
} finally {
  await writeFile(
    path.join(output, 'results.json'),
    JSON.stringify(
      {
        mode: '真实浏览器，模拟身份/存储/逐块SSE；不证明真实模型语义效果',
        results,
        errors,
        modelRequestCount: requests.length,
      },
      null,
      2,
    ),
  );
  await browser.close();
}
console.log(`PASS ${results.length} 个流程，${errors.length} 个浏览器错误。`);
