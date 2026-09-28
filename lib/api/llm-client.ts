/**
 * LLM API 工具 — 模型列表查询等
 *
 * 注意：流式调用已迁移至 stream-client.ts
 * 此文件仅保留 fetchAvailableModels（ApiSettings 组件使用）
 */

export interface ModelInfo {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

interface ModelsListResponse {
  object: string;
  data: ModelInfo[];
}

/**
 * 通过同源后端接口获取模型列表，避免服务商的浏览器跨域限制。
 * @param endpoint - API endpoint URL (会自动提取 base URL)
 * @param apiKey - API 密钥
 * @returns 模型列表
 */
export async function fetchAvailableModels(endpoint: string, apiKey: string): Promise<ModelInfo[]> {
  const response = await fetch('/api/models', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ endpoint, apiKey }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || `获取模型列表失败: ${response.status}`);
  }

  const data = (await response.json()) as ModelsListResponse;
  return data.data || [];
}
