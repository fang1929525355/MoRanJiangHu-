import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { uploadApkFileToOpenListWithCurl, verifyOpenListApkFiles } from './upload-apk-onedrive.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apkPath = path.resolve(
  process.argv[2]
  || path.join(rootDir, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
);
const releaseInfo = JSON.parse(fs.readFileSync(path.join(rootDir, 'release.config.json'), 'utf8'));
const apkSize = fs.statSync(apkPath).size;
const baseUrl = String(process.env.MORAN_OPENLIST_BASE_URL || 'https://openlist.bacon.de5.net').replace(/\/+$/, '');
const authToken = String(process.env.MORAN_OPENLIST_AUTH_TOKEN || '').trim();
const timeoutMs = Math.max(1000, Number(process.env.MORAN_OPENLIST_UPLOAD_TIMEOUT_MS || 600000));

const uploaded = uploadApkFileToOpenListWithCurl({
  apkPath,
  versionName: releaseInfo.versionName,
  targetRoot: '/夸克/MoRanJiangHu/releases',
  baseUrl,
  authToken,
  timeoutMs
});
const verified = await verifyOpenListApkFiles({
  versionName: releaseInfo.versionName,
  expectedSize: apkSize,
  downloadRoot: '/夸克TV/MoRanJiangHu/releases',
  baseUrl,
  authToken
});

console.log(JSON.stringify({ uploaded, verified }, null, 2));
