export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function apiError(error: unknown): Response {
  if (error instanceof HttpError)
    return Response.json(
      { error: error.message },
      { status: error.status, headers: { 'Cache-Control': 'no-store' } },
    );
  // Do not return connection strings, SQL, WeChat secrets or upstream payloads.
  console.error('[api] 服务端操作失败', error instanceof Error ? error.name : 'UnknownError');
  return Response.json(
    { error: '服务暂不可用，请稍后重试' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (Buffer.byteLength(text) > 2_000_000) throw new HttpError(413, '请求内容过大');
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new HttpError(400, '请求格式错误');
  }
}

export function checkOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (request.headers.get('sec-fetch-site') === 'cross-site')
    throw new HttpError(403, '请求来源无效');
  if (!origin) return;

  const url = new URL(request.url);
  // Next.js may build request.url with its bind address (e.g. 0.0.0.0).
  // Host identifies the browser-facing destination, including its public port.
  // Reverse proxies must preserve Host; Next.js resolves the forwarded protocol.
  const host = request.headers.get('host');
  const expectedOrigin = host ? new URL(`${url.protocol}//${host}`).origin : url.origin;
  if (origin !== expectedOrigin) throw new HttpError(403, '请求来源无效');
}
