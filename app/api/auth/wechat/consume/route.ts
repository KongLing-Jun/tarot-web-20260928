import { NextRequest, NextResponse } from 'next/server';
import { consumeLoginTicket, SESSION_COOKIE } from '@/lib/server/auth';
import { getServerNumber } from '@/lib/api/server-config';
import { apiError } from '@/lib/server/http';
import { loginReturnPath } from '@/lib/auth/redirect';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const sessionSeconds = getServerNumber('SESSION_SECONDS');
    const token = await consumeLoginTicket(
      request.nextUrl.searchParams.get('ticket'),
      sessionSeconds,
    );
    const response = new NextResponse(null, {
      status: 303,
      headers: {
        Location: loginReturnPath(request.nextUrl.searchParams.get('next')),
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    });
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
