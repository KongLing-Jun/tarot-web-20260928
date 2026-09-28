import { readFileSync, writeFileSync } from 'node:fs';
import brand from '../miniprogram/brand.js';

const mode = process.argv[2];
if (!['--check', '--write'].includes(mode)) {
  throw new Error('用法：node scripts/sync-brand.mjs --check|--write');
}
const file = new URL('../miniprogram/app.json', import.meta.url);
const source = readFileSync(file, 'utf8');
const app = JSON.parse(source);
if (typeof app.window?.navigationBarTitleText !== 'string' || !brand.name.trim()) {
  throw new Error('品牌或小程序导航栏配置格式无效');
}
if (app.window.navigationBarTitleText !== brand.name) {
  if (mode === '--check') {
    throw new Error('小程序导航栏标题与品牌配置不一致，请运行 npm run brand:sync');
  }
  // 仅替换已验证的唯一标题字段，保留所有其他字段、缩进与换行。
  const title = /("navigationBarTitleText"\s*:\s*)"(?:[^"\\]|\\.)*"/g;
  if ([...source.matchAll(title)].length !== 1) throw new Error('导航栏标题字段不唯一');
  writeFileSync(
    file,
    source.replace(title, (_, prefix) => prefix + JSON.stringify(brand.name)),
  );
}
console.log(mode === '--check' ? '品牌展示配置一致' : '品牌展示配置已同步');
