import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import { readSettings, numberSetting } from './config.mjs';

const config = readSettings();
if (!config.DATABASE_URL) throw new Error('model.config.json 缺少 DATABASE_URL');
const client = new pg.Client({
  connectionString: config.DATABASE_URL,
  connectionTimeoutMillis: numberSetting(config, 'DATABASE_CONNECT_TIMEOUT_MS'),
});
try {
  await client.connect();
  const directory = new URL('../database/', import.meta.url);
  for (const file of readdirSync(directory)
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort()) {
    await client.query(readFileSync(new URL(file, directory), 'utf8'));
  }
  console.log(
    '用户资料、登录会话、占卜历史、聊天消息、每日牌、图片资源及充值订单、抽卡次数账本、用户可用抽卡次数表和充值方案表已就绪。',
  );
} catch (error) {
  console.error('数据库初始化失败：', error.code || '连接或执行异常');
  process.exitCode = 1;
} finally {
  await client.end();
}
