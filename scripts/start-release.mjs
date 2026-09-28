import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readSettings, numberSetting } from './config.mjs';

// Resolve configuration relative to the extracted release, even under a service manager.
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const config = readSettings();
if (typeof config.WEB_HOST !== 'string' || !config.WEB_HOST.trim()) {
  throw new Error('model.config.json 缺少 WEB_HOST');
}
const port = numberSetting(config, 'WEB_PORT');
if (port > 65535) throw new Error('WEB_PORT 必须小于等于 65535');
const child = spawn(process.execPath, ['server.js'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    HOSTNAME: config.WEB_HOST.trim(),
    PORT: String(port),
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', (error) => {
  console.error('启动失败：', error.message);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
});
