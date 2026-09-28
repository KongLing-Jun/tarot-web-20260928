import sharp from 'sharp';
import { MAX_AVATAR_BYTES } from '@/lib/auth/profile';
import { HttpError } from './http';

export async function normalizeAvatarImage(value: unknown): Promise<Buffer> {
  if (typeof value !== 'string' || value.length > (MAX_AVATAR_BYTES * 4) / 3 + 100) {
    throw new HttpError(400, '头像文件过大，请重新选择图片');
  }
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new HttpError(400, '请选择 JPG、PNG 或 WebP 图片');
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > MAX_AVATAR_BYTES) throw new HttpError(400, '头像文件过大，请重新选择图片');
  try {
    const image = sharp(buffer, { limitInputPixels: 16_000_000, failOn: 'warning' });
    const metadata = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format || '') || (metadata.pages || 1) > 1)
      throw new Error();
    return await image.rotate().resize(256, 256, { fit: 'cover' }).webp({ quality: 85 }).toBuffer();
  } catch {
    throw new HttpError(400, '无法读取头像，请选择有效的静态图片');
  }
}
