// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { getStaticImageUrl, saveImageAsset, saveAvatarImage } from '@/lib/server/image-assets';
import { putOssImage } from '@/lib/server/oss';
import { GET } from '@/app/api/assets/[...path]/route';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/server/database', () => ({ database: () => ({ query }) }));
vi.mock('@/lib/server/oss', () => ({ putOssImage: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
});

describe('OSS image registry', () => {
  it('uploads before recording the content hash and URL; retries use the same object key', async () => {
    const data = Buffer.from('image-bytes');
    const digest = createHash('sha256').update(data).digest('hex');
    const url = 'https://images.example/fool.jpg';
    vi.mocked(putOssImage).mockResolvedValue(url);
    query.mockResolvedValue({ rows: [{ url }] });
    const options = {
      assetKey: '/cards/fool.jpg',
      kind: 'static' as const,
      data,
      contentType: 'image/jpeg',
    };
    await saveImageAsset(options);
    await saveImageAsset(options);
    expect(putOssImage).toHaveBeenNthCalledWith(
      1,
      `static/cards/fool.${digest}.jpg`,
      data,
      'image/jpeg',
    );
    expect(vi.mocked(putOssImage).mock.calls[1][0]).toBe(vi.mocked(putOssImage).mock.calls[0][0]);
    expect(query.mock.calls[0][1]).toEqual([
      '/cards/fool.jpg',
      'static',
      null,
      `static/cards/fool.${digest}.jpg`,
      url,
      'image/jpeg',
      data.length,
      digest,
    ]);
    expect(vi.mocked(putOssImage).mock.invocationCallOrder[0]).toBeLessThan(
      query.mock.invocationCallOrder[0],
    );
  });

  it('does not record a URL when upload fails', async () => {
    vi.mocked(putOssImage).mockRejectedValue(new Error('OSS unavailable'));
    await expect(
      saveImageAsset({
        assetKey: '/test.png',
        kind: 'static',
        data: Buffer.from('x'),
        contentType: 'image/png',
      }),
    ).rejects.toThrow('OSS unavailable');
    expect(query).not.toHaveBeenCalled();
  });

  it('keeps avatar ownership and generates distinct object names', async () => {
    vi.mocked(putOssImage).mockResolvedValue('https://images.example/avatar.webp');
    query.mockResolvedValue({ rows: [{ url: 'https://images.example/avatar.webp' }] });
    await saveAvatarImage('owner', Buffer.from('a'));
    await saveAvatarImage('owner', Buffer.from('a'));
    expect(query.mock.calls[0][1][2]).toBe('owner');
    expect(query.mock.calls[0][1][1]).toBe('avatar');
    expect(query.mock.calls[0][1][0]).not.toBe(query.mock.calls[1][1][0]);
  });

  it('serves registered static URLs and never exposes credentials or avatar metadata', async () => {
    query.mockResolvedValue({ rows: [{ url: 'https://images.example/fool.jpg' }] });
    const response = await GET(new Request('https://example.com/api/assets/cards/fool.jpg'), {
      params: Promise.resolve({ path: ['cards', 'fool.jpg'] }),
    });
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://images.example/fool.jpg');
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    expect(await response.text()).toBe('');
    expect(query.mock.calls[0][0]).toContain("kind = 'static'");
    expect(query.mock.calls[0][1]).toEqual(['/cards/fool.jpg']);
  });

  it('returns uncached 404 for missing resources and rejects traversal', async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(getStaticImageUrl('/missing.jpg')).rejects.toMatchObject({ status: 404 });
    query.mockClear();
    const response = await GET(new Request('https://example.com'), {
      params: Promise.resolve({ path: ['..', 'model.config.json'] }),
    });
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(query).not.toHaveBeenCalled();
  });
});
