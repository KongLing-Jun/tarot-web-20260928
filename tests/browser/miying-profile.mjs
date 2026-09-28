// 隔离浏览器内的合成登录状态测试，不使用真实账号或登录票据。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const brand = require('../../miniprogram/brand.js');
const { chromium, webkit } = require('playwright');
const baseUrl = process.argv[2];
if (!baseUrl || !['http:', 'https:'].includes(new URL(baseUrl).protocol))
  throw new Error('请传入测试站点 URL');
const output = path.resolve(process.argv[3] ?? 'docs/tasks/miying-profile-browser');
const profileOnly = process.argv.includes('--profile-only');
await mkdir(output, { recursive: true });
const engine = process.env.BROWSER_ENGINE || 'chromium';
const browser = await (engine === 'webkit' ? webkit : chromium).launch({
  headless: true,
  ...(engine === 'chromium' ? { channel: process.env.BROWSER_CHANNEL || undefined } : {}),
});
const results = [];
const errors = [];
const user = {
  nickname: '星旅人1',
  avatarUrl: '/avatars/default.svg',
  createdAt: '2026-09-09T18:30:00.000Z',
};

async function checkLayout(page) {
  const avatar = page.getByRole('img', { name: '用户头像', exact: true });
  if (await avatar.count()) await avatar.evaluate((image) => image.decode());
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    '无横向溢出',
  );
  assert.equal(await page.getByRole('region', { name: '账号信息' }).count(), 0);
  const badge = page.getByText('微信已登录', { exact: true });
  const input = page.getByRole('textbox', { name: '昵称', exact: true });
  const name = (await input.count()) ? input : page.getByRole('button', { name: /，修改昵称$/ });
  if ((await badge.count()) && (await name.count())) {
    const badgeBox = await badge.boundingBox();
    const nameBox = await name.boundingBox();
    assert.ok(badgeBox.y >= nameBox.y + nameBox.height, '登录标记始终在昵称下一行');
    assert.ok(badgeBox.y <= nameBox.y + nameBox.height + 12, '登录标记紧跟昵称，不插入空白提示区');
    assert.ok(Math.abs(badgeBox.x - nameBox.x) < 1, '昵称与登录标记左对齐');
    const avatarBox = await page
      .getByRole('button', { name: '更换头像', exact: true })
      .boundingBox();
    assert.ok(nameBox.x >= avatarBox.x + avatarBox.width + 8, '恢复头像左侧、昵称右侧的布局');
  }
}

async function settleLayout(page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
}

async function trackRenameGeometry(page) {
  await page.evaluate(() => {
    const measure = () => {
      const avatar = document.querySelector('button[aria-label="更换头像"]');
      const control =
        document.querySelector('input[autocomplete="nickname"]') ||
        document.querySelector('button[aria-label$="，修改昵称"]');
      const badge = [...document.querySelectorAll('span')].find(
        (node) => node.textContent === '微信已登录',
      );
      const rect = (node) => {
        const box = node.getBoundingClientRect();
        return [box.x + scrollX, box.y + scrollY, box.width, box.height];
      };
      // Compact errors may expand downstream content; identity anchors must remain stable.
      return [avatar, control, control.closest('h2'), badge].flatMap(rect);
    };
    const baseline = measure();
    const trace = (window.renameGeometry = {
      baseline,
      maxDelta: 0,
      samples: 0,
      frame: 0,
      scroll: scrollY,
      maxScrollDelta: 0,
    });
    const sample = () => {
      const current = measure();
      const delta = Math.max(...current.map((value, index) => Math.abs(value - baseline[index])));
      if (delta > trace.maxDelta) {
        trace.maxDelta = delta;
        trace.changed = current;
      }
      trace.maxScrollDelta = Math.max(trace.maxScrollDelta, Math.abs(scrollY - trace.scroll));
      trace.samples++;
      trace.frame = requestAnimationFrame(sample);
    };
    sample();
  });
}

async function checkRenameGeometry(page, stop = false) {
  const trace = await page.evaluate(async (stop) => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const trace = window.renameGeometry;
    if (stop) cancelAnimationFrame(trace.frame);
    return trace;
  }, stop);
  assert.ok(
    trace.maxDelta < 1,
    `重命名各状态的位置和尺寸保持稳定，最大变化 ${trace.maxDelta}px: ${JSON.stringify({ before: trace.baseline, after: trace.changed })}`,
  );
  assert.ok(trace.maxScrollDelta < 1, `重命名没有额外滚动，最大变化 ${trace.maxScrollDelta}px`);
}

try {
  for (const viewport of [
    { width: 320, height: 740 },
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1440, height: 900 },
  ]) {
    const context = await browser.newContext({
      viewport,
      reducedMotion: 'reduce',
      isMobile: viewport.width < 768,
      hasTouch: viewport.width < 768,
    });
    let status = 'signed-in';
    let nickname = user.nickname;
    let authRequests = 0;
    let mutations = 0;
    let failNextSave = false;
    let holdSave = false;
    let releaseSave;
    let releaseRequest;
    await context.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/auth/me') {
        authRequests++;
        if (status === 'pending')
          await new Promise((resolve) => {
            releaseRequest = resolve;
          });
        if (status === 'signed-out')
          return route.fulfill({ status: 401, json: { error: '登录已过期' } });
        if (status === 'error')
          return route.fulfill({ status: 503, json: { error: '暂时不可用' } });
        if (route.request().method() === 'PATCH') {
          mutations++;
          if (holdSave)
            await new Promise((resolve) => {
              releaseSave = resolve;
            });
          if (failNextSave) {
            failNextSave = false;
            return route.fulfill({ status: 503, json: { error: '保存失败，请稍后重试' } });
          }
          nickname = route.request().postDataJSON().nickname;
        }
        return route.fulfill({ json: { user: { ...user, nickname } } });
      }
      if (url.pathname === '/api/config') return route.fulfill({ json: { available: true } });
      if (url.pathname === '/api/payments' && route.request().method() === 'GET')
        return route.fulfill({
          json: { balance: 0, enabled: false, offer: { amountFen: 1, points: 1 }, orders: [] },
        });
      if (url.pathname === '/api/readings')
        return route.fulfill({ json: { readings: [], hasMore: false } });
      if (url.pathname === '/api/messages')
        return route.fulfill({ json: { messages: [], hasMore: false } });
      if (url.pathname.startsWith('/api/assets/')) return route.continue();
      throw new Error(`未定义的测试 API：${url.pathname}`);
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && !/status of (401|503)/.test(message.text()))
        errors.push(message.text());
    });
    await page.goto(new URL('/profile', baseUrl).href);
    await page.getByText('微信已登录', { exact: true }).waitFor();
    assert.equal(await page.getByText('2026 年 9 月 10 日', { exact: true }).count(), 0);
    await page.evaluate(() => document.fonts.ready);
    await checkLayout(page);
    await page.screenshot({
      path: path.join(output, `${viewport.width}-profile.png`),
      fullPage: true,
      animations: 'disabled',
    });
    assert.equal(await page.getByText('修改用户', { exact: true }).count(), 0);
    assert.equal(await page.getByText('昵称:', { exact: true }).count(), 0);
    assert.equal(
      await page.getByText('The Seeker', { exact: true }).count(),
      0,
      '紧凑参考稿不含额外英文身份标题',
    );
    const rename = page.getByRole('button', { name: /，修改昵称$/ });
    const target = await rename.boundingBox();
    assert.ok(target.width >= 44 && target.height >= 44, '昵称触控区域至少 44px');
    await rename.focus();
    await rename.press('Enter');
    const input = page.getByRole('textbox', { name: '昵称', exact: true });
    await input.waitFor();
    assert.ok(await input.evaluate((node) => node === document.activeElement));
    assert.deepEqual(await input.evaluate((node) => [node.selectionStart, node.selectionEnd]), [
      0,
      user.nickname.length,
    ]);
    assert.equal(await page.getByText('编辑个人资料', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '保存修改', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '取消', exact: true }).count(), 0);
    const inputBox = await input.boundingBox();
    assert.ok(
      Math.abs(inputBox.x - target.x) < 2 && inputBox.width >= target.width - 2,
      '输入框保持起点并使用可用宽度',
    );
    await checkLayout(page);
    await page.screenshot({
      path: path.join(output, `${viewport.width}-editing.png`),
      fullPage: true,
      animations: 'disabled',
    });
    await input.fill('未保存昵称');
    await input.press('Escape');
    assert.ok(await rename.evaluate((node) => node === document.activeElement));
    assert.equal(mutations, 0);
    await rename.press('Space');
    await input.waitFor();
    assert.equal(await input.inputValue(), user.nickname);
    await input.fill('新的星旅人');
    await input.press('Enter');
    await page.getByRole('status').filter({ hasText: '昵称已保存' }).waitFor();
    assert.equal(mutations, 1);
    assert.equal(await rename.getAttribute('aria-label'), '新的星旅人，修改昵称');
    assert.ok(await rename.evaluate((node) => node === document.activeElement));
    await page.waitForLoadState('networkidle');
    await page.reload();
    await page.getByRole('button', { name: '新的星旅人，修改昵称', exact: true }).waitFor();
    await rename.click();
    await input.fill('失焦保存');
    await page.getByRole('heading', { name: '我的', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '昵称已保存' }).waitFor();
    assert.equal(nickname, '失焦保存');
    assert.equal(
      await rename.evaluate((node) => node === document.activeElement),
      false,
      '失焦保存不抢回焦点',
    );
    await rename.click();
    await input.fill('头像跳转');
    await page.getByRole('button', { name: '更换头像', exact: true }).click();
    await page.waitForURL('**/profile/avatar');
    assert.equal(nickname, '头像跳转');
    await page.waitForLoadState('networkidle');
    await page.goto(new URL('/profile', baseUrl).href);
    await rename.waitFor();

    for (const [fixture, value] of [
      ['long-name', 'M'.repeat(40)],
      ['chinese-name', '星'.repeat(40)],
      ['short-name', '星'],
    ]) {
      nickname = value;
      await page.waitForLoadState('networkidle');
      await page.reload();
      await page.getByText(nickname, { exact: true }).waitFor();
      await page.evaluate(() => window.scrollTo(0, 0));
      await settleLayout(page);
      await checkLayout(page);
      assert.equal(await rename.textContent(), value, '省略显示保留完整昵称内容');
      assert.ok(
        await rename.evaluate(
          (node) => getComputedStyle(node.firstElementChild).textOverflow === 'ellipsis',
        ),
        '长昵称使用单行省略显示',
      );
      const nameBox = await rename.boundingBox();
      const badgeBox = await page.getByText('微信已登录', { exact: true }).boundingBox();
      assert.ok(
        Math.abs(badgeBox.x - nameBox.x) < 1 && badgeBox.y >= nameBox.y + nameBox.height,
        '紧凑身份区保留昵称与登录标记顺序',
      );
      await page.screenshot({
        path: path.join(output, `${viewport.width}-${fixture}.png`),
        animations: 'disabled',
      });
      await trackRenameGeometry(page);
      await rename.click();
      await input.waitFor();
      await checkLayout(page);
      assert.ok(
        await input.evaluate(
          (node) =>
            node.getBoundingClientRect().height <=
            Math.max(44, parseFloat(getComputedStyle(node.parentElement).lineHeight)) + 2,
        ),
        '编辑态仅保留一行，无隐藏多行占位',
      );
      await page.screenshot({
        path: path.join(output, `${viewport.width}-${fixture}-editing.png`),
        animations: 'disabled',
      });
      if (fixture === 'short-name') {
        const avatar = page.getByRole('button', { name: '更换头像', exact: true });
        const avatarBefore = await avatar.boundingBox();
        const availableWidth = (await input.boundingBox()).width;
        assert.ok(availableWidth >= 120, '最窄手机保留可用的昵称编辑宽度');
        const beforeBlank = mutations;
        for (const value of ['', '   ', '\u3000', '\u00a0']) {
          for (const action of ['Enter', 'blur']) {
            await input.fill(value);
            if (action === 'Enter') await input.press('Enter');
            else await page.getByRole('heading', { name: '我的', exact: true }).click();
            await rename.waitFor();
            assert.equal(await input.count(), 0, '空白完成或失焦直接结束编辑');
            assert.equal(await rename.textContent(), '星', '取消后恢复已保存昵称');
            assert.equal(await page.locator('#nickname-error').count(), 0, '空白取消不显示错误');
            assert.equal(
              await page.getByText('昵称已保存', { exact: true }).count(),
              0,
              '取消不误报保存成功',
            );
            assert.equal(mutations, beforeBlank, '空白取消不发出保存请求');
            assert.equal(
              await rename.evaluate((node) => node === document.activeElement),
              action === 'Enter',
              '只有键盘完成恢复昵称焦点',
            );
            await checkRenameGeometry(page);
            await rename.click();
            assert.equal(await input.inputValue(), '星', '重新编辑读取已保存昵称');
          }
        }
        for (const [state, value, message] of [
          ['overlong', 'M'.repeat(41), '昵称最多 40 个字符'],
          ['save-error', '测试新昵称', '保存失败，请稍后重试'],
        ]) {
          failNextSave = state === 'save-error';
          await input.fill(value);
          await input.press('Enter');
          const alert = page.getByRole('alert').filter({ hasText: message });
          await alert.waitFor();
          await checkLayout(page);
          assert.ok(
            await alert.evaluate(
              (node) =>
                node.getBoundingClientRect().height <=
                parseFloat(getComputedStyle(node).lineHeight) * 2 + 1,
            ),
            '常见错误提示不超过两行',
          );
          const errorBox = await alert.boundingBox();
          const badgeBox = await page.getByText('微信已登录', { exact: true }).boundingBox();
          assert.ok(
            errorBox.y >= badgeBox.y + badgeBox.height,
            '反馈位于登录标记下方，不挤开昵称与登录标记',
          );
          assert.ok(
            Math.abs((await avatar.boundingBox()).y - avatarBefore.y) < 1,
            '错误提示不移动头像',
          );
          assert.ok(
            Math.abs((await input.boundingBox()).width - availableWidth) < 1,
            '错误提示不改变输入宽度',
          );
          await checkRenameGeometry(page);
          await page.screenshot({
            path: path.join(output, `${viewport.width}-${state}.png`),
            animations: 'disabled',
          });
        }
        await input.fill('');
        await page.getByRole('heading', { name: '我的', exact: true }).click();
        await rename.waitFor();
        assert.equal(await page.locator('#nickname-error').count(), 0, '失败后清空取消也移除错误');
        await checkRenameGeometry(page);
        await rename.click();
        await input.fill('星');
        await input.press('Enter');
        await rename.waitFor();
        await checkRenameGeometry(page);
        await rename.click();
        await input.fill('取消的昵称');
        await input.press('Escape');
        await rename.waitFor();
        await checkRenameGeometry(page);
        await rename.click();
        await input.fill('已保存的新昵称');
        holdSave = true;
        await input.press('Enter');
        await page.waitForFunction(() => document.querySelector('input[readonly]') !== null);
        await checkRenameGeometry(page);
        await page.screenshot({
          path: path.join(output, `${viewport.width}-pending.png`),
          animations: 'disabled',
        });
        assert.ok(releaseSave);
        holdSave = false;
        releaseSave();
        await rename.waitFor();
        await checkRenameGeometry(page);
        await rename.click();
        await input.fill('M'.repeat(41));
        await input.press('Enter');
        await checkRenameGeometry(page, true);
        if (viewport.width === 390) {
          await page.evaluate(() => {
            document.documentElement.style.fontSize = '20px';
          });
          await checkLayout(page);
          assert.ok(
            await page
              .locator('#nickname-error')
              .evaluate((node) => node.scrollWidth <= node.clientWidth),
            '放大文字后错误提示完整显示',
          );
          await page.screenshot({
            path: path.join(output, `${viewport.width}-larger-text.png`),
            fullPage: true,
            animations: 'disabled',
          });
          await page.evaluate(() => {
            document.documentElement.style.fontSize = '';
          });
        }
      }
      await input.press('Escape');
      if (fixture !== 'short-name') await checkRenameGeometry(page, true);
    }

    status = 'signed-out';
    await page.waitForLoadState('networkidle');
    await page.reload();
    await page.getByText('尚未登录', { exact: true }).waitFor();
    assert.equal(await rename.count(), 0);
    await checkLayout(page);
    const retry = page.getByRole('button', { name: '重新检查登录', exact: true });
    await retry.scrollIntoViewIfNeeded();
    const box = await retry.boundingBox();
    assert.ok(box.height >= 44, '触控高度至少 44px');
    const navBox = await page.getByRole('navigation', { name: '主导航' }).boundingBox();
    if (viewport.width < 768) assert.ok(box.y + box.height <= navBox.y, '重试按钮不被底部导航遮挡');
    await page.screenshot({
      path: path.join(output, `${viewport.width}-signed-out.png`),
      fullPage: true,
      animations: 'disabled',
    });
    status = 'pending';
    const beforeRetry = authRequests;
    await retry.click();
    await page.getByText('正在检查登录状态…', { exact: true }).waitFor();
    assert.equal(await retry.isDisabled(), true);
    assert.equal(await page.getByText('尚未登录', { exact: true }).count(), 0);
    await page.waitForFunction(() => document.querySelector('[aria-busy="true"]') !== null);
    assert.equal(authRequests, beforeRetry + 1);
    assert.ok(releaseRequest);
    status = 'signed-in';
    releaseRequest();
    await page.getByText('微信已登录', { exact: true }).waitFor();

    status = 'error';
    await page.waitForLoadState('networkidle');
    await page.reload();
    await page.getByRole('alert').filter({ hasText: '暂时无法读取登录状态，请重试' }).waitFor();
    assert.equal(await page.getByText('尚未登录', { exact: true }).count(), 0);
    await checkLayout(page);
    await page.screenshot({
      path: path.join(output, `${viewport.width}-error.png`),
      fullPage: true,
      animations: 'disabled',
    });
    status = 'signed-in';
    await page.getByRole('button', { name: '重新检查登录', exact: true }).click();
    await page.getByText('微信已登录', { exact: true }).waitFor();

    if (!profileOnly) {
      await page.goto(new URL('/', baseUrl).href);
      await page.getByRole('heading', { name: brand.name, exact: true }).waitFor();
      assert.equal(await page.title(), brand.name);
      await page.evaluate(() => document.fonts.ready);
      await checkLayout(page);
      await page.screenshot({
        path: path.join(output, `${viewport.width}-home.png`),
        fullPage: true,
        animations: 'disabled',
      });
      assert.equal(
        await page.getByRole('link', { name: /说说正在困扰你的事/ }).getAttribute('href'),
        '/agent',
      );
      assert.equal(
        await page.getByRole('link', { name: /自己选择牌阵/ }).getAttribute('href'),
        '/reading',
      );
      await page.getByRole('link', { name: '对话', exact: true }).click();
      await page.getByRole('textbox', { name: '探索问题或追问' }).waitFor();
      await page.goto(new URL('/', baseUrl).href);
      await page.getByRole('link', { name: '轨迹', exact: true }).click();
      await page.getByRole('heading', { name: '解读记录', exact: true }).waitFor();
    }
    results.push({
      viewport,
      checks: [
        '恢复头像昵称左右布局',
        '移除修改用户和昵称前缀',
        '昵称点击与键盘编辑',
        '保存取消与焦点恢复',
        '长短昵称单行显示',
        '重命名逐帧布局与滚动稳定',
        '401与重试',
        '加载状态及重复点击保护',
        '503与恢复',
        '无横向溢出',
        ...(!profileOnly ? ['首页品牌', '导航与原有路由'] : []),
      ],
    });
    await page.waitForLoadState('networkidle');
    await context.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await writeFile(
    path.join(output, 'results.json'),
    JSON.stringify(
      { mode: `${engine} 浏览器、模拟登录 API，非微信真机`, results, errors },
      null,
      2,
    ),
  );
  await browser.close();
}
console.log(`完成 ${results.length} 种视口，${errors.length} 个非预期浏览器错误`);
