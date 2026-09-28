import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { apiError } from '@/lib/server/http';
import { ownedOrder, queryRecharge } from '@/lib/server/payments';

export const runtime = 'nodejs';
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;
    return Response.json(
      { order: await queryRecharge(await ownedOrder(id, user.id)) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
}
