import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { apiError, HttpError, readJson } from '@/lib/server/http';
import { analyzeIntent, parseIntentRequest } from '@/lib/server/intent';
import { getIntentRecognitionEnabled } from '@/lib/api/server-config';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    if (!getIntentRecognitionEnabled()) throw new HttpError(503, '意图识别尚未启用');
    const input = parseIntentRequest(await readJson(request));
    const intent = await analyzeIntent(user.id, input, request.signal);
    return Response.json(intent, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
