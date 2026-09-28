import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { apiError } from '@/lib/server/http';
import { getPublicStreamSettings } from '@/lib/api/stream-settings';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    await requireUser(request);
    return Response.json(getPublicStreamSettings(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
