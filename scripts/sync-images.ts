import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { database } from '../lib/server/database';
import { getStaticImageUrl, saveImageAsset } from '../lib/server/image-assets';
import { normalizeAvatarImage } from '../lib/server/avatar-image';
import { createOssClient, ossObjectUrl } from '../lib/server/oss';

const mimeTypes: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
};

async function findImages(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await findImages(filename)));
    else if (entry.isFile() && mimeTypes[path.extname(filename).toLowerCase()])
      files.push(filename);
  }
  return files.sort();
}

async function main() {
  const client = createOssClient();
  const pool = database();
  // Fail before uploading anything if the schema has not been migrated.
  await pool.query('SELECT asset_key FROM tarot_image_assets LIMIT 0');
  const publicRoot = path.resolve('public');
  const files = (await findImages(publicRoot)).map((filename) => ({
    filename,
    assetKey: `/${path.relative(publicRoot, filename).split(path.sep).join('/')}`,
  }));
  files.push({ filename: path.resolve('app/favicon.ico'), assetKey: '/favicon.ico' });
  let uploaded = 0,
    skipped = 0,
    migrated = 0;

  for (const { filename, assetKey } of files) {
    const data = await readFile(filename);
    const sha256 = createHash('sha256').update(data).digest('hex');
    const existing = await pool.query<{ object_key: string; url: string; sha256: string }>(
      "SELECT object_key, url, sha256 FROM tarot_image_assets WHERE asset_key = $1 AND kind = 'static'",
      [assetKey],
    );
    const row = existing.rows[0];
    if (row?.sha256 === sha256 && row.url === ossObjectUrl(row.object_key)) {
      try {
        const head = await client.head(row.object_key);
        if (
          Number((head.res.headers as Record<string, string>)['content-length']) === data.length
        ) {
          skipped++;
          continue;
        }
      } catch (error) {
        if ((error as { status?: number }).status !== 404) throw error;
      }
    }
    const asset = await saveImageAsset({
      assetKey,
      kind: 'static',
      data,
      contentType: mimeTypes[path.extname(filename).toLowerCase()],
    });
    if (row && row.url !== asset.url) {
      await pool.query('UPDATE tarot_users SET avatar_url = $1 WHERE avatar_url = $2', [
        asset.url,
        row.url,
      ]);
    }
    uploaded++;
    console.log(`已上传 ${assetKey}`);
  }

  // Compare-and-swap prevents a concurrent user edit from being overwritten.
  const users = await pool.query<{ id: string; avatar_url: string }>(
    "SELECT id, avatar_url FROM tarot_users WHERE avatar_url LIKE 'data:%' OR avatar_url LIKE '/%'",
  );
  for (const user of users.rows) {
    let url: string;
    if (user.avatar_url.startsWith('/')) {
      url = await getStaticImageUrl(user.avatar_url);
    } else {
      const data = await normalizeAvatarImage(user.avatar_url);
      const hash = createHash('sha256').update(data).digest('hex');
      const asset = await saveImageAsset({
        assetKey: `/uploads/avatars/migrated-${user.id}-${hash}.webp`,
        kind: 'avatar',
        userId: user.id,
        data,
        contentType: 'image/webp',
      });
      url = asset.url;
    }
    const result = await pool.query(
      'UPDATE tarot_users SET avatar_url = $1 WHERE id = $2 AND avatar_url = $3',
      [url, user.id, user.avatar_url],
    );
    migrated += result.rowCount || 0;
  }
  // Keep the database default in sync, including users inserted outside the app.
  const defaultUrl = await getStaticImageUrl('/avatars/default.svg');
  await pool.query(
    `ALTER TABLE tarot_users ALTER COLUMN avatar_url SET DEFAULT '${defaultUrl.replaceAll("'", "''")}'`,
  );
  const remaining = await pool.query<{ count: string }>(`
    SELECT count(*) FROM tarot_users u WHERE NOT EXISTS
      (SELECT 1 FROM tarot_image_assets a WHERE a.url = u.avatar_url)`);
  if (Number(remaining.rows[0].count)) throw new Error('仍有未登记的头像 URL，需要迁移');
  console.log(
    `图片同步完成：${files.length} 个静态资源，上传 ${uploaded}，跳过 ${skipped}，迁移头像 ${migrated}。`,
  );
}

main()
  .catch((error) => {
    // SDK errors can contain signed request headers. Never log the full object.
    console.error(
      '图片同步失败：',
      error.code || error.name || 'UnknownError',
      '请检查配置、权限和网络后重试。',
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await database().end();
  });
