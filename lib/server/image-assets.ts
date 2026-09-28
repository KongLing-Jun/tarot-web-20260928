import { createHash, randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { database } from './database';
import { HttpError } from './http';
import { putOssImage } from './oss';

export interface ImageAsset {
  asset_key: string;
  kind: 'static' | 'avatar';
  user_id: string | null;
  object_key: string;
  url: string;
  content_type: string;
  byte_size: string;
  sha256: string;
}

export async function getStaticImageUrl(assetKey: string): Promise<string> {
  const result = await database().query<{ url: string }>(
    "SELECT url FROM tarot_image_assets WHERE asset_key = $1 AND kind = 'static'",
    [assetKey],
  );
  if (!result.rows[0]) throw new HttpError(404, '图片资源不存在');
  return result.rows[0].url;
}

export async function saveImageAsset(options: {
  assetKey: string;
  kind: 'static' | 'avatar';
  userId?: string;
  data: Buffer;
  contentType: string;
}): Promise<ImageAsset> {
  const { assetKey, kind, userId, data, contentType } = options;
  if (
    !/^\/[a-zA-Z0-9_./-]+$/.test(assetKey) ||
    assetKey.split('/').some((part) => part === '..' || part === '.') ||
    !data.length ||
    (kind === 'avatar' && !userId) ||
    (kind === 'static' && userId)
  ) {
    throw new Error('无效的图片资源');
  }
  const sha256 = createHash('sha256').update(data).digest('hex');
  const extension = extname(assetKey);
  const stem = assetKey.slice(1, extension ? -extension.length : undefined);
  const objectKey = `${kind}/${stem}.${sha256}${extension}`;
  // Content-addressed keys make retries safe and preserve URLs already in use.
  // A failed upload must never create a database record or change a user's avatar.
  const url = await putOssImage(objectKey, data, contentType);
  const result = await database().query<ImageAsset>(
    `
    INSERT INTO tarot_image_assets (asset_key, kind, user_id, object_key, url, content_type, byte_size, sha256)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (asset_key) DO UPDATE SET
      object_key = EXCLUDED.object_key, url = EXCLUDED.url, content_type = EXCLUDED.content_type,
      byte_size = EXCLUDED.byte_size, sha256 = EXCLUDED.sha256, updated_at = now()
    WHERE tarot_image_assets.kind = EXCLUDED.kind
      AND tarot_image_assets.user_id IS NOT DISTINCT FROM EXCLUDED.user_id
    RETURNING *`,
    [assetKey, kind, userId || null, objectKey, url, contentType, data.length, sha256],
  );
  if (!result.rows[0]) throw new Error('图片资源归属冲突');
  return result.rows[0];
}

export async function saveAvatarImage(userId: string, data: Buffer): Promise<string> {
  const asset = await saveImageAsset({
    assetKey: `/uploads/avatars/${randomUUID()}.webp`,
    kind: 'avatar',
    userId,
    data,
    contentType: 'image/webp',
  });
  return asset.url;
}
