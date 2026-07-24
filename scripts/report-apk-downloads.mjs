import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wrangler = process.platform === 'win32'
  ? path.join(rootDir, 'node_modules', '.bin', 'wrangler.cmd')
  : path.join(rootDir, 'node_modules', '.bin', 'wrangler');
const sql = `SELECT day, version_name, provider, request_count, updated_at
FROM apk_download_daily
ORDER BY day DESC, request_count DESC
LIMIT 100`;

const result = spawnSync(wrangler, [
  'd1', 'execute', 'moranjianghu-db', '--remote', '--command', sql, '--json'
], {
  cwd: rootDir,
  encoding: 'utf8',
  timeout: 60_000
});

if (result.status !== 0) {
  throw new Error((result.stderr || result.stdout || result.error?.message || 'Wrangler query failed').trim());
}
process.stdout.write(result.stdout);
