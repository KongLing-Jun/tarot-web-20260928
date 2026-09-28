import { getModelConfig, getIntentRecognitionEnabled } from '@/lib/api/server-config';
import { apiError } from '@/lib/server/http';

export async function GET() {
  try {
    const available = getModelConfig() !== null;
    return Response.json(
      { available, intentEnabled: available && getIntentRecognitionEnabled() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
}
