import { NextRequest, NextResponse } from 'next/server';
import { loginWithGuest, SESSION_COOKIE } from '@/lib/server/auth';
import { getServerNumber } from '@/lib/api/server-config';
import { apiError, checkOrigin, readJson } from '@/lib/server/http';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    checkOrigin(request);
    const { credential } = await readJson(request);
    const sessionSeconds = getServerNumber('SESSION_SECONDS');
    const token = await loginWithGuest(credential, sessionSeconds);
    const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: sessionSeconds,
    });
    return response;
  } catch (error) {
    return apiError(error);
  }
}
