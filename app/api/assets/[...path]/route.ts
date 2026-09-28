import { getStaticImageUrl } from '@/lib/server/image-assets';
import { apiError, HttpError } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const { path } = await context.params;
    if (
      !path.length ||
      path.some(
        (segment) => !/^[a-zA-Z0-9_.-]+$/.test(segment) || segment === '.' || segment === '..',
      )
    ) {
      throw new HttpError(404, '图片资源不存在');
    }
    const url = await getStaticImageUrl(`/${path.join('/')}`);
    return new Response(null, {
      status: 307,
      headers: {
        Location: url,
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
