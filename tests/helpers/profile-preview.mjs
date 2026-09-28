// Explicit, loopback-only visual fixture harness. Never imported by the application.
// Usage: node tests/helpers/profile-preview.mjs <preview-port> <next-port> [--production]
import { createServer, request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const [previewArg, upstreamArg] = process.argv.slice(2);
const previewPort = Number(previewArg);
const upstreamPort = Number(upstreamArg);
if (
  ![previewPort, upstreamPort].every((p) => Number.isInteger(p) && p >= 1024 && p <= 65535) ||
  previewPort === upstreamPort
) {
  throw new Error('Provide two distinct unprivileged local ports.');
}
const root = process.cwd();
const production = process.argv.includes('--production');
const child = spawn(
  process.execPath,
  [
    path.join(root, 'node_modules/next/dist/bin/next'),
    production ? 'start' : 'dev',
    ...(production ? [] : ['--webpack']),
    '--hostname',
    '127.0.0.1',
    '--port',
    String(upstreamPort),
  ],
  { cwd: root, stdio: 'inherit', env: process.env },
);
let scenario = 'signed-in';
let failSave = false;
let user = makeUser();
function makeUser() {
  return {
    nickname: '123',
    avatarUrl: '/avatars/default.svg',
    createdAt: new Date(Date.now() - 6 * 86400000).toISOString(),
    readingCount: 18,
    creditBalance: 300,
    favoriteCardIds: Array.from({ length: 16 }, (_, i) => 'fixture-' + i),
  };
}
function json(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Profile-Preview': 'isolated-test-fixtures',
  });
  res.end(JSON.stringify(data));
}
async function body(req) {
  let value = '';
  for await (const chunk of req) {
    value += chunk;
    if (value.length > 16384) throw new Error('Fixture request too large.');
  }
  return JSON.parse(value || '{}');
}
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1:' + previewPort);
    // This endpoint changes this harness's in-memory fixtures only.
    if (url.pathname === '/__fixture' && req.method === 'POST') {
      const change = await body(req);
      if (change.reset) {
        user = makeUser();
        scenario = 'signed-in';
        failSave = false;
      }
      if (['signed-in', 'signed-out', 'error', 'loading'].includes(change.scenario))
        scenario = change.scenario;
      if (typeof change.nickname === 'string') user.nickname = change.nickname;
      if (Number.isSafeInteger(change.creditBalance) && change.creditBalance >= 0)
        user.creditBalance = change.creditBalance;
      if (typeof change.failSave === 'boolean') failSave = change.failSave;
      return json(res, 200, { scenario });
    }
    if (url.pathname === '/api/auth/me') {
      if (scenario === 'loading') await new Promise((resolve) => setTimeout(resolve, 2500));
      if (scenario === 'signed-out') return json(res, 401, { error: '登录已过期' });
      if (scenario === 'error') return json(res, 503, { error: '测试服务暂不可用' });
      if (req.method === 'PATCH') {
        if (failSave) {
          failSave = false;
          return json(res, 503, { error: '保存失败，请稍后重试' });
        }
        const change = await body(req);
        if (change.nickname !== undefined) {
          if (
            typeof change.nickname !== 'string' ||
            !change.nickname.trim() ||
            Array.from(change.nickname.trim()).length > 40 ||
            /[\p{Cc}\p{Zl}\p{Zp}]/u.test(change.nickname)
          ) {
            return json(res, 400, { error: '昵称不符合要求' });
          }
          user.nickname = change.nickname.trim();
        }
      } else if (req.method !== 'GET')
        return json(res, 405, { error: 'Unsupported fixture method' });
      return json(res, 200, { user });
    }
    if (url.pathname === '/api/agent-session' && req.method === 'GET')
      return json(res, 200, { tasks: [], revision: 0 });
    if (url.pathname === '/api/config' && req.method === 'GET')
      return json(res, 200, { available: false });
    if (url.pathname === '/api/messages' && req.method === 'GET')
      return json(res, 200, { messages: [], hasMore: false });
    if (url.pathname === '/api/readings' && req.method === 'GET')
      return json(res, 200, { readings: [], hasMore: false });
    if (url.pathname === '/api/payments' && req.method === 'GET')
      return json(res, 200, {
        balance: user.creditBalance,
        enabled: false,
        plans: [],
        orders: [],
        refunds: [],
      });
    if (
      url.pathname === '/avatars/default.svg' ||
      url.pathname === '/api/assets/avatars/default.svg'
    ) {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache' });
      return res.end(await readFile(path.join(root, 'public/avatars/default.svg')));
    }
    if (url.pathname.startsWith('/api/'))
      return json(res, 501, { error: 'This isolated visual preview does not access live APIs.' });
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Preview only' });
    const headers = { ...req.headers, host: '127.0.0.1:' + upstreamPort };
    delete headers.cookie;
    delete headers.authorization;
    const upstream = httpRequest(
      { hostname: '127.0.0.1', port: upstreamPort, path: req.url, method: req.method, headers },
      (incoming) => {
        const outgoing = { ...incoming.headers };
        delete outgoing['set-cookie'];
        res.writeHead(incoming.statusCode || 502, outgoing);
        incoming.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) json(res, 503, { error: 'Next preview is starting. Reload shortly.' });
      else res.end();
    });
    req.pipe(upstream);
  } catch {
    if (!res.headersSent) json(res, 400, { error: 'Invalid fixture request' });
    else res.end();
  }
});
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/_next/')) {
    socket.destroy();
    return;
  }
  const headers = { ...req.headers, host: '127.0.0.1:' + upstreamPort };
  delete headers.cookie;
  delete headers.authorization;
  const upstream = httpRequest({
    hostname: '127.0.0.1',
    port: upstreamPort,
    path: req.url,
    headers,
  });
  upstream.on('upgrade', (response, remote, remoteHead) => {
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        Object.entries(response.headers)
          .map(([k, v]) => k + ': ' + v)
          .join('\r\n') +
        '\r\n\r\n',
    );
    if (head.length) remote.write(head);
    if (remoteHead.length) socket.write(remoteHead);
    socket.pipe(remote);
    remote.pipe(socket);
    socket.on('error', () => remote.destroy());
    remote.on('error', () => socket.destroy());
  });
  upstream.on('error', () => socket.destroy());
  upstream.end();
});
server.listen(previewPort, '127.0.0.1', () =>
  console.log('Isolated profile fixture preview: http://127.0.0.1:' + previewPort + '/profile'),
);
function stop() {
  server.close();
  child.kill();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', () => server.close());
