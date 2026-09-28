import { MAX_AVATAR_BYTES } from './profile';

export async function prepareAvatar(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('请选择 JPG、PNG 或 WebP 图片');
  }
  if (file.size > 5 * 1024 * 1024) throw new Error('图片不能超过 5 MB');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('无法读取图片，请重新选择'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前环境无法处理图片，请重试');
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    if (!side) throw new Error('无法读取图片，请重新选择');
    context.fillStyle = '#0E0B18';
    context.fillRect(0, 0, 256, 256);
    context.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      256,
      256,
    );
    const result = canvas.toDataURL('image/jpeg', 0.9);
    if (result.length > (MAX_AVATAR_BYTES * 4) / 3) throw new Error('处理后的图片过大，请换一张');
    return result;
  } finally {
    URL.revokeObjectURL(url);
  }
}
