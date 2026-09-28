import { spawn } from 'node:child_process';
import { readSettings, numberSetting } from './config.mjs';

const mode = process.argv[2];
if (!['dev', 'miniapp', 'start'].includes(mode)) throw new Error('未知启动模式');
const config = readSettings();
const prefix = mode === 'miniapp' ? 'MINIAPP_DEV' : 'WEB';
const hostname = config[`${prefix}_HOST`];
if (typeof hostname !== 'string' || !hostname.trim()) throw new Error(`缺少 ${prefix}_HOST`);
const port = numberSetting(config, `${prefix}_PORT`);
if (port > 65535) throw new Error(`${prefix}_PORT 必须小于等于 65535`);
const child = spawn(
  process.execPath,
  [
    'node_modules/next/dist/bin/next',
    mode === 'start' ? 'start' : 'dev',
    '--hostname',
    hostname.trim(),
    '--port',
    String(port),
    ...process.argv.slice(3),
  ],
  { stdio: 'inherit' },
);
child.on('error', () => {
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
