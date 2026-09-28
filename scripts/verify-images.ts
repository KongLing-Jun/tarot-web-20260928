import { createHash } from 'node:crypto';
import { database } from '../lib/server/database';
import type { ImageAsset } from '../lib/server/image-assets';

async function main() {
  const result = await database().query<ImageAsset>(
    'SELECT * FROM tarot_image_assets ORDER BY asset_key',
  );
  if (!result.rows.length) throw new Error('图片资源表为空');
  for (const asset of result.rows) {
    const response = await fetch(asset.url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type')?.split(';')[0];
    if (contentType !== asset.content_type) throw new Error('图片类型不匹配');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (
      bytes.length !== Number(asset.byte_size) ||
      createHash('sha256').update(bytes).digest('hex') !== asset.sha256
    ) {
      throw new Error('图片大小或摘要不匹配');
    }
  }
  const users = await database().query<{ count: string }>(`
    SELECT count(*) FROM tarot_users u WHERE NOT EXISTS
      (SELECT 1 FROM tarot_image_assets a WHERE a.url = u.avatar_url)`);
  if (Number(users.rows[0].count)) throw new Error('用户头像尚未全部登记到图片资源表');
  console.log(
    `验证通过：${result.rows.length} 个 OSS 图片均可匿名读取，类型、大小和 SHA-256 与数据库一致；用户头像全部已登记。`,
  );
}

main()
  .catch((error) => {
    console.error('图片验证失败：', error instanceof Error ? error.message : 'UnknownError');
    process.exitCode = 1;
  })
  .finally(async () => {
    await database().end();
  });
