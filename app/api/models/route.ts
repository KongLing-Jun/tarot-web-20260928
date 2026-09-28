import { getModelConfig, getServerNumber } from '@/lib/api/server-config';
import { apiError } from '@/lib/server/http';

export const runtime = 'nodejs';

function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

export async function POST(request: Request): Promise<Response> {
  // Keep accepting legacy POSTs, but never use client-supplied provider settings.
  void request;
  const config = getModelConfig();
  if (!config) return jsonError('AI 服务暂不可用，请稍后重试', 503);
  const { endpoint, apiKey } = config;
  let timeoutMs: number;
  try {
    timeoutMs = getServerNumber('MODEL_LIST_TIMEOUT_MS');
  } catch (error) {
    return apiError(error);
  }

  let modelsUrl: URL;
  try {
    modelsUrl = new URL(endpoint.trim());
    if (
      !['http:', 'https:'].includes(modelsUrl.protocol) ||
      modelsUrl.username ||
      modelsUrl.password
    ) {
      throw new Error('Invalid endpoint');
    }
    // 兼容完整聊天地址和 base URL，并保留服务商的自定义路径前缀。
    const basePath = modelsUrl.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
    modelsUrl.pathname = `${basePath}/models`;
    modelsUrl.hash = '';
  } catch {
    return jsonError('AI 服务暂不可用，请稍后重试', 503);
  }

  try {
    const response = await fetch(modelsUrl, {
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      // 不回显上游响应，避免服务商的错误信息包含密钥。
      const hint =
        response.status === 401 || response.status === 403
          ? '请检查 API 密钥和模型访问权限'
          : response.status === 404
            ? '请检查 API 地址，或手动填写模型名称'
            : '请稍后重试或检查服务商状态';
      return jsonError(`获取模型列表失败 (${response.status})：${hint}`, response.status);
    }

    const data = await response.json();
    if (
      !data ||
      !Array.isArray(data.data) ||
      !data.data.every(
        (model: unknown) =>
          model && typeof model === 'object' && 'id' in model && typeof model.id === 'string',
      )
    ) {
      return jsonError('服务商返回的模型列表格式不正确，请手动填写模型名称', 502);
    }

    return Response.json({ data: data.data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return jsonError('获取模型列表超时，请稍后重试', 504);
    }
    return jsonError('无法获取模型列表，请检查 API 地址和服务商连接', 502);
  }
}
