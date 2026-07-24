import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wranglerEntryPath = path.join(rootDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const sql = `SELECT day, version_name, provider, request_count, updated_at
FROM apk_download_daily
ORDER BY day DESC, request_count DESC
LIMIT 100`;

export const buildWranglerInvocation = (
  args,
  nodeExecutable = process.execPath,
  wranglerEntry = wranglerEntryPath
) => ({
  command: nodeExecutable,
  args: [wranglerEntry, ...args]
});

export const buildDownloadReportArgs = (query) => [
  'd1',
  'execute',
  'moranjianghu-db',
  '--remote',
  '--command',
  query,
  '--json'
];

export const reportApkDownloads = () => {
  const invocation = buildWranglerInvocation(buildDownloadReportArgs(sql));
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: rootDir,
    encoding: 'utf8',
    timeout: 60_000
  });

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || result.error?.message || 'Wrangler query failed').trim());
  }
  process.stdout.write(result.stdout);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  reportApkDownloads();
}
