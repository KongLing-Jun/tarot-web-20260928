import { loginWithWechat } from '@/lib/server/auth';
import { apiError, readJson } from '@/lib/server/http';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const { code } = await readJson(request);
    const ticket = await loginWithWechat(code);
    return Response.json({ ticket }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
