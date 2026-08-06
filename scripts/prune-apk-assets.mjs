import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const apkPublicAssetsDir = path.join(rootDir, 'android', 'app', 'src', 'main', 'assets', 'public', 'assets');

const removableDirs = [
  // These generated preset item images are mirrored from hosted image URLs used
  // by the app, and are too large to bundle into every APK release.
  'item-presets',
  // 拍卖行固定拍品图标（约 42MB）由站点自身以远程 URL 提供，APK 不再打包，避免体积膨胀。
  'auction-items'
];

let removedBytes = 0;
let removedFiles = 0;

const collectStats = (target) => {
  if (!fs.existsSync(target)) return;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) {
      collectStats(child);
    } else if (entry.isFile()) {
      removedBytes += fs.statSync(child).size;
      removedFiles += 1;
    }
  }
};

for (const dirName of removableDirs) {
  const target = path.join(apkPublicAssetsDir, dirName);
  collectStats(target);
  fs.rmSync(target, { recursive: true, force: true });
}

console.log(`APK asset prune complete: removed ${removedFiles} files, ${(removedBytes / 1024 / 1024).toFixed(2)} MB`);
