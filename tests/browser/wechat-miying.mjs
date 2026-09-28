// 只读检查开发者工具截图和分享配置，不发送分享、不读取登录票据。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const brand = require('../../miniprogram/brand.js');
const automator = require('miniprogram-automator');
const endpoint = process.env.WECHAT_AUTOMATION_ENDPOINT;
if (!endpoint) throw new Error('缺少 WECHAT_AUTOMATION_ENDPOINT');
const output = path.resolve(process.argv[2] ?? 'docs/tasks/miying-profile-wechat');
await mkdir(output, { recursive: true });
let miniProgram;
let stage = 'connect';
const save = (result) =>
  writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
const deadline = setTimeout(async () => {
  await save({
    status: 'incomplete',
    stage,
    reason: 'SDK 只读检查在 30 秒内未完成，不能算作模拟器或微信真机验收通过。',
  });
  console.log(`开发者工具只读检查超时：${stage}`);
  miniProgram?.disconnect();
  process.exit(1);
}, 30000);
try {
  miniProgram = await automator.connect({ wsEndpoint: endpoint });
  stage = 'currentPage';
  const page = await miniProgram.currentPage();
  assert.equal(page?.path, 'pages/index/index');
  stage = 'screenshot';
  await miniProgram.screenshot({ path: path.join(output, 'simulator.png') });
  stage = 'shareConfiguration';
  const share = await page.callMethod('onShareAppMessage');
  assert.deepEqual(share, {
    title: `${brand.name} · ${brand.tagline}`,
    path: '/pages/index/index',
  });
  await save({
    status: 'shell-checked',
    share,
    limitation: '仅开发者工具外壳与分享回调，未向任何人发送分享，未验证 iOS/Android 真机。',
  });
  console.log('截图与分享配置检查完成');
} catch {
  await save({
    status: 'incomplete',
    stage,
    reason: 'SDK 未完成本次只读检查，不能算作模拟器或微信真机验收通过。',
  });
  console.log(`开发者工具只读检查未完成：${stage}`);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  miniProgram?.disconnect();
}
