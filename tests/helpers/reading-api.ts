import { vi } from 'vitest';

// In-memory HTTP fixture for hook tests; exercise the real async storage client.
export function mockReadingApi() {
  const readings = new Map<string, Record<string, unknown>>();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, options?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      const method = options?.method ?? 'GET';
      if (url.pathname === '/api/readings' && method === 'POST') {
        const reading = JSON.parse(String(options?.body));
        readings.set(reading.id, reading);
        return Response.json({ ok: true });
      }
      if (url.pathname === '/api/readings' && method === 'GET') {
        return Response.json({ readings: [...readings.values()], hasMore: false });
      }
      if (url.pathname.startsWith('/api/readings/') && method === 'PATCH') {
        const id = decodeURIComponent(url.pathname.slice('/api/readings/'.length));
        const reading = readings.get(id);
        if (!reading) return Response.json({ error: '记录不存在' }, { status: 404 });
        readings.set(id, { ...reading, ...JSON.parse(String(options?.body)) });
        return Response.json({ ok: true });
      }
      throw new Error(`Unexpected reading API request: ${method} ${url.pathname}`);
    }),
  );
}
