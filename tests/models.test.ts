// @vitest-environment node
import { createServer, type Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/models/route';
import { fetchAvailableModels } from '@/lib/api/llm-client';
import { readFileSync } from 'node:fs';
import exampleConfig from '../model.config.example.json';

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  readFileSync: vi.fn(),
}));

function configure(overrides: Record<string, unknown> = {}) {
  vi.mocked(readFileSync).mockReturnValue(
    JSON.stringify({
      ...exampleConfig,
      MODEL_BASE_URL: origin,
      MODEL_API_KEY: 'test-key',
      ...overrides,
    }),
  );
}

beforeEach(() => configure());

const models = [{ id: 'test-model', object: 'model', created: 0, owned_by: 'test' }];
let server: Server;
let origin: string;
let receivedPath: string | undefined;
let receivedAuthorization: string | undefined;

beforeAll(async () => {
  // 故意不返回 CORS 头，模拟不允许浏览器直连的服务商。
  server = createServer((request, response) => {
    receivedPath = request.url;
    receivedAuthorization = request.headers.authorization;
    if (request.headers.authorization !== 'Bearer test-key') {
      response.writeHead(403);
      response.end('sensitive upstream error');
    } else {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ data: models }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
afterEach(() => vi.unstubAllGlobals());

function request(body: unknown): Request {
  return new Request('http://localhost/api/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('model list proxy', () => {
  it.each([
    ['/v1/chat/completions', '/v1/models'],
    ['/v1/', '/v1/models'],
    ['/chat/completions/', '/models'],
    ['/custom/provider/api/chat/completions', '/custom/provider/api/models'],
    ['', '/models'],
  ])('fetches %s without requiring upstream CORS headers', async (path, expected) => {
    configure({ MODEL_BASE_URL: origin + path });
    const response = await POST(request({}));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: models });
    expect(receivedPath).toBe(expected);
    expect(receivedAuthorization).toBe('Bearer test-key');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('preserves authentication failure without returning upstream sensitive text', async () => {
    configure({ MODEL_API_KEY: 'wrong-key' });
    const response = await POST(request({}));
    expect(response.status).toBe(403);
    const text = await response.text();
    expect(text).toContain('密钥');
    expect(text).not.toContain('sensitive');
  });

  it.each([
    null,
    {},
    { MODEL_BASE_URL: 'invalid', MODEL_API_KEY: 'key' },
    { MODEL_BASE_URL: 'file:///tmp', MODEL_API_KEY: 'key' },
  ])('rejects invalid server configuration %j', async (config) => {
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));
    expect((await POST(request({}))).status).toBe(503);
  });

  it('ignores client and environment provider overrides', async () => {
    vi.stubEnv('MODEL_BASE_URL', 'https://env.invalid');
    vi.stubEnv('MODEL_API_KEY', 'env-key');
    try {
      const response = await POST(
        request({ endpoint: 'https://client.invalid', apiKey: 'client-key' }),
      );
      expect(response.status).toBe(200);
      expect(receivedAuthorization).toBe('Bearer test-key');
      expect(receivedPath).toBe('/models');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('reloads provider settings on the next request', async () => {
    await POST(request({}));
    configure({ MODEL_BASE_URL: `${origin}/updated` });
    expect((await POST(request({}))).status).toBe(200);
    expect(receivedPath).toBe('/updated/models');
  });

  it('fails without a timeout setting instead of using an implicit default', async () => {
    const config: Record<string, unknown> = {
      ...exampleConfig,
      MODEL_BASE_URL: origin,
      MODEL_API_KEY: 'test-key',
    };
    delete config.MODEL_LIST_TIMEOUT_MS;
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(config));
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await POST(request({}))).status).toBe(503);
      expect(upstream).not.toHaveBeenCalled();
    } finally {
      logger.mockRestore();
    }
  });

  it('reports upstream timeouts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError')));
    expect((await POST(request({ endpoint: origin, apiKey: 'test-key' }))).status).toBe(504);
  });

  it('rejects malformed upstream model lists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: [{}] })));
    expect((await POST(request({ endpoint: origin, apiKey: 'test-key' }))).status).toBe(502);
  });
});

describe('model list client', () => {
  it('sends credentials in a same-origin POST body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: models }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchAvailableModels(origin, 'test-key')).toEqual(models);
    expect(fetchMock).toHaveBeenCalledWith('/api/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: origin, apiKey: 'test-key' }),
    });
  });

  it('shows the proxy error message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: '请检查 API 密钥' }, { status: 403 })),
    );
    await expect(fetchAvailableModels(origin, 'bad-key')).rejects.toThrow('请检查 API 密钥');
  });
});
