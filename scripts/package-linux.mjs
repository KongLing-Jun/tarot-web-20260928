import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const architecture = process.argv[2];
const nodeArchitecture = { amd64: 'x64', arm64: 'arm64' }[architecture];
if (process.platform !== 'linux' || !nodeArchitecture || process.arch !== nodeArchitecture) {
  throw new Error('This packaging script must run inside Docker on the target Linux architecture.');
}
const root = '/release';
if (existsSync(root)) throw new Error('/release already exists; use a fresh build stage.');
// Turbopack's external dependency aliases are relative symlinks. Preserve them
// verbatim so copying does not turn them into absolute paths to the build tree.
cpSync('.next/standalone', root, { recursive: true, verbatimSymlinks: true });
cpSync('.next/static', `${root}/.next/static`, { recursive: true });
cpSync('public', `${root}/public`, { recursive: true });
cpSync('database', `${root}/database`, { recursive: true });
mkdirSync(`${root}/scripts`, { recursive: true });
for (const name of ['config.mjs', 'migrate-db.mjs', 'start-release.mjs']) {
  cpSync(`scripts/${name}`, `${root}/scripts/${name}`);
}
for (const name of ['model.config.example.json', 'LICENSE']) cpSync(name, `${root}/${name}`);
// Even the build's placeholder configuration must not become a production config.
rmSync(`${root}/model.config.json`, { force: true });
function checkLinks(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const target = readlinkSync(filename);
      const relative = path.relative(root, path.resolve(directory, target));
      if (path.isAbsolute(target) || relative.startsWith('..') || !existsSync(filename)) {
        throw new Error(`Non-portable release symlink: ${filename}`);
      }
    } else if (entry.isDirectory()) checkLinks(filename);
  }
}
checkLinks(root);
const manifest = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'));
manifest.scripts = {
  start: 'node scripts/start-release.mjs',
  'db:migrate': 'node scripts/migrate-db.mjs',
};
writeFileSync(`${root}/package.json`, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(
  `${root}/BUILD.json`,
  `${JSON.stringify(
    {
      platform: `linux/${architecture}`,
      node: process.version,
      distribution: 'Debian 12 (bookworm)',
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);
// Verify native and external dependencies resolve from the release itself.
execFileSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    `
  import sharp from 'sharp';
  import pg from 'pg';
  import OSS from 'ali-oss';
  if (typeof pg.Client !== 'function' || typeof OSS !== 'function') throw new Error('Missing runtime dependencies');
  await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } }).webp().toBuffer();
`,
  ],
  { cwd: root, stdio: 'inherit' },
);
mkdirSync('/artifacts', { recursive: true });
const filename = `tarot-whisper-linux-${architecture}.tar.gz`;
execFileSync('tar', ['-czf', `/artifacts/${filename}`, '-C', root, '.']);
const bytes = readFileSync(`/artifacts/${filename}`);
// Keep the artifact below GitHub's regular Git per-file limit.
if (bytes.length >= 100 * 1024 * 1024)
  throw new Error('Release exceeds 100 MiB; use Git LFS for this artifact.');
writeFileSync(
  `/artifacts/${filename}.sha256`,
  `${createHash('sha256').update(bytes).digest('hex')}  ${filename}\n`,
);
console.log(`Exported ${filename} (${(bytes.length / 1024 / 1024).toFixed(1)} MiB)`);
