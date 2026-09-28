// 只读检查已开启自动化的本项目模拟器；不读取票据、不改变页面数据。
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const automator = require('miniprogram-automator');
const endpoint = process.env.WECHAT_AUTOMATION_ENDPOINT;
if (!endpoint) throw new Error('缺少 WECHAT_AUTOMATION_ENDPOINT');
const output = path.resolve(process.argv[2] ?? 'docs/tasks/reading-output-wechat');
await mkdir(output, { recursive: true });
let miniProgram;
let stage = 'connect';
const deadline = setTimeout(async () => {
  await writeFile(
    path.join(output, 'results.json'),
    JSON.stringify(
      {
        status: 'timeout',
        stage,
        limitation:
          'CLI 已开启自动化，但 SDK 未能在 30 秒内完成只读模拟器检查；未验证 web-view 内部交互或微信真机。',
      },
      null,
      2,
    ),
  );
  console.log(`模拟器自动化超时：${stage}`);
  miniProgram?.disconnect();
  process.exit(1);
}, 30000);
try {
  miniProgram = await automator.connect({ wsEndpoint: endpoint });
  stage = 'currentPage';
  const page = await miniProgram.currentPage();
  if (!page || page.path !== 'pages/index/index') throw new Error('当前不是本项目入口页');
  stage = 'pageData';
  const message = await page.data('message');
  stage = 'screenshot';
  await miniProgram.screenshot({ path: path.join(output, 'simulator.png') });
  const result = {
    page: page.path,
    message,
    limitation:
      '原生自动化只能检查 web-view 外层，截图不代表内部解读交互或 iOS/Android 微信真机验收。',
  };
  await writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  const result = {
    status: 'incomplete',
    reason: error instanceof Error ? error.message : '自动化失败',
  };
  await writeFile(path.join(output, 'results.json'), JSON.stringify(result, null, 2));
  console.log(result.reason);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  miniProgram?.disconnect();
}
