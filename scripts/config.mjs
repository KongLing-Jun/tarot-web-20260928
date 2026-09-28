import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Read afresh so server settings take effect on the next request. */
export function readSettings() {
  const config = JSON.parse(readFileSync(path.join(process.cwd(), 'model.config.json'), 'utf8'));
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('model.config.json 必须是 JSON 对象');
  }
  return config;
}

/** All values must be explicitly present in the private runtime file. */
export function numberSetting(config, key) {
  if (!Object.hasOwn(config, key)) throw new Error(`model.config.json 缺少 ${key}`);
  const value = config[key];
  const minimum = 1;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > 2_147_483_647
  ) {
    throw new Error(`model.config.json 的 ${key} 必须是有效整数（最小 ${minimum}）`);
  }
  return value;
}
