// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { BRAND } from '@/lib/brand';

it('keeps approved canonical names and display variants', () => {
  expect(BRAND).toMatchObject({
    name: '月映卡语',
    englishName: 'moonlit',
    englishTitle: 'Moonlit',
    englishWordmark: 'MOONLIT',
  });
});

it('detects title drift without writing, then syncs only the title idempotently', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'moonlit-brand-'));
  try {
    mkdirSync(path.join(directory, 'scripts'));
    mkdirSync(path.join(directory, 'miniprogram'));
    const script = path.join(directory, 'scripts/sync-brand.mjs');
    copyFileSync('scripts/sync-brand.mjs', script);
    copyFileSync('miniprogram/brand.js', path.join(directory, 'miniprogram/brand.js'));
    const file = path.join(directory, 'miniprogram/app.json');
    const source =
      '{\r\n  "pages": ["pages/index/index"],\r\n  "window": { "navigationBarTitleText": "旧标题", "navigationBarTextStyle": "white" }\r\n}\r\n';
    writeFileSync(file, source);
    const check = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
    expect(check.status).not.toBe(0);
    expect(check.stderr).toContain('npm run brand:sync');
    expect(readFileSync(file, 'utf8')).toBe(source);
    execFileSync(process.execPath, [script, '--write']);
    const updated = readFileSync(file, 'utf8');
    expect(updated).toBe(source.replace('旧标题', BRAND.name));
    execFileSync(process.execPath, [script, '--write']);
    execFileSync(process.execPath, [script, '--check']);
    expect(readFileSync(file, 'utf8')).toBe(updated);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
