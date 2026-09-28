// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { updateProfile } from '@/lib/server/profile';
import { GET, PATCH } from '@/app/api/auth/me/route';
import { requireUser } from '@/lib/server/auth';
import { NextRequest } from 'next/server';
import { HttpError } from '@/lib/server/http';
import { getStaticImageUrl, saveAvatarImage } from '@/lib/server/image-assets';
import { companionDays } from '@/lib/auth/profile';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/server/database', () => ({ database: () => ({ query }) }));
vi.mock('@/lib/server/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/auth')>()),
  requireUser: vi.fn(),
}));
vi.mock('@/lib/server/image-assets', () => ({
  getStaticImageUrl: vi.fn(),
  saveAvatarImage: vi.fn(),
}));
const user = {
  id: 'internal-uuid',
  publicId: 'seeker',
  nickname: '星旅人',
  avatarUrl: '/avatars/default.svg',
  createdAt: '2026-09-09',
  readingCount: 12,
  creditBalance: 300,
  favoriteCardIds: [],
};

it.each([
  ['2026-09-10T16:00:00Z', 1],
  ['2026-09-10T15:59:59Z', 2],
  ['2026-09-08T16:00:00Z', 3],
  ['2026-09-12T00:00:00Z', 0],
  ['invalid', 0],
  [undefined, 0],
])('counts companion calendar days from %s, including the creation day', (createdAt, expected) => {
  expect(companionDays(createdAt, new Date('2026-09-11T00:00:00Z'))).toBe(expected);
});

describe('profile updates', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    query.mockResolvedValue({ rows: [user] });
    vi.mocked(requireUser).mockResolvedValue(user);
    vi.mocked(getStaticImageUrl).mockResolvedValue('https://images.example/static/default.svg');
    vi.mocked(saveAvatarImage).mockResolvedValue('https://images.example/avatar/new.webp');
  });

  it.each([
    {},
    { readingCount: 999 },
    { creditBalance: 999 },
    { id: 'someone-else' },
    { publicId: 'seeker' },
    { nickname: null },
    { nickname: '' },
    { nickname: '   ' },
    { nickname: 'a'.repeat(41) },
    { nickname: 'a\nb' },
    { avatarUrl: 'https://example.com/a.jpg' },
    { avatarUrl: 'data:image/svg+xml;base64,PHN2Zz4=' },
  ])('rejects invalid or unsupported changes: %j', async (body) => {
    await expect(updateProfile(user.id, body)).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  it('updates only supplied fields and scopes the query to the internal user ID', async () => {
    await updateProfile(user.id, { nickname: '  你好1  ' });
    expect(query.mock.calls[0][0]).toContain('SET nickname = $2 WHERE id = $1');
    expect(query.mock.calls[0][1]).toEqual([user.id, '你好1']);
  });

  it.each(['月', '你好1', 'Moon 🌙!', '🌙'.repeat(40)])(
    'accepts unrestricted display-name characters: %s',
    async (nickname) => {
      await expect(updateProfile(user.id, { nickname })).resolves.toBeDefined();
      expect(query.mock.calls[0][1]).toEqual([user.id, nickname]);
    },
  );

  it('never exposes identity fields in the GET response', async () => {
    const response = await GET(new NextRequest('http://localhost/api/auth/me'));
    expect(await response.json()).toEqual({
      user: {
        nickname: user.nickname,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt,
        readingCount: 12,
        creditBalance: 300,
        favoriteCardIds: [],
      },
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('decodes and re-encodes uploaded images as a bounded square WebP', async () => {
    const input = await sharp({
      create: { width: 600, height: 400, channels: 3, background: '#ddbbaa' },
    })
      .png()
      .toBuffer();
    await updateProfile(user.id, {
      avatarUrl: `data:image/png;base64,${input.toString('base64')}`,
    });
    const stored = vi.mocked(saveAvatarImage).mock.calls[0][1];
    expect(vi.mocked(saveAvatarImage).mock.calls[0][0]).toBe(user.id);
    expect(query.mock.calls[0][1][1]).toBe('https://images.example/avatar/new.webp');
    const metadata = await sharp(stored).metadata();
    expect(metadata).toMatchObject({ format: 'webp', width: 256, height: 256 });
  });

  it.each([
    'data:image/png;base64,bm90LWFuLWltYWdl',
    `data:image/jpeg;base64,${'A'.repeat(710000)}`,
  ])('rejects corrupt or oversized images', async (avatarUrl) => {
    await expect(updateProfile(user.id, { avatarUrl })).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  it('allows restoring the default avatar without changing the ID', async () => {
    await updateProfile(user.id, { avatarUrl: '/avatars/default.svg' });
    expect(query.mock.calls[0][0]).toContain('SET avatar_url = $2 WHERE id = $1');
    expect(query.mock.calls[0][1][1]).toBe('https://images.example/static/default.svg');
    expect(saveAvatarImage).not.toHaveBeenCalled();
  });

  it('preserves the current profile when OSS upload fails', async () => {
    vi.mocked(saveAvatarImage).mockRejectedValue(new Error('Upload failed'));
    const input = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } })
      .png()
      .toBuffer();
    await expect(
      updateProfile(user.id, { avatarUrl: `data:image/png;base64,${input.toString('base64')}` }),
    ).rejects.toThrow('Upload failed');
    expect(query).not.toHaveBeenCalled();
  });

  it('authenticates PATCH before writing and returns an uncached updated profile', async () => {
    const request = new NextRequest('http://localhost/api/auth/me', {
      method: 'PATCH',
      body: JSON.stringify({ nickname: '星旅人' }),
    });
    const response = await PATCH(request);
    expect(requireUser).toHaveBeenCalledWith(request);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      user: {
        nickname: user.nickname,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt,
        readingCount: 12,
        creditBalance: 300,
        favoriteCardIds: [],
      },
    });
    vi.mocked(requireUser).mockRejectedValue(new HttpError(401, '请登录'));
    query.mockClear();
    expect((await PATCH(request)).status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });
});
