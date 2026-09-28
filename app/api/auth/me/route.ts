import { NextRequest } from 'next/server';
import { publicProfile, requireUser } from '@/lib/server/auth';
import { apiError, readJson } from '@/lib/server/http';
import { updateProfile } from '@/lib/server/profile';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    return Response.json(
      { user: publicProfile(await requireUser(request)) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const updated = await updateProfile(user.id, await readJson(request));
    return Response.json(
      { user: publicProfile(updated) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
}
