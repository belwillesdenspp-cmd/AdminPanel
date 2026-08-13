import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const configPath = path.join(root, 'config', 'apps.json');
const apps = JSON.parse(fs.readFileSync(configPath, 'utf8'));

for (const app of apps) {
  const cwd = path.resolve(root, app.cwd);
  const basePath = app.publicPath.endsWith('/') ? app.publicPath : `${app.publicPath}/`;
  console.log(`\n[build-apps] ${app.id} BASE_PATH=${basePath} cwd=${cwd}`);

  const result = spawnSync('npm', ['run', 'build'], {
    cwd,
    env: { ...process.env, BASE_PATH: basePath.replace(/\/$/, '') || '/' },
    shell: true,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    console.error(`[build-apps] failed: ${app.id}`);
    process.exit(result.status || 1);
  }
}

console.log('\n[build-apps] done');
