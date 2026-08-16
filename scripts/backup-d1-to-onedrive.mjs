/**
 * backup-d1-to-onedrive.mjs
 *
 * 将生产 D1 数据库（moranjianghu-db-backup，新账号）全量导出并上传到
 * OneDrive /Onedrive/MoRanJiangHu/d1-backups/，自动清理超出保留数量的旧备份。
 *
 * 背景：2026-08-16 创意工坊清空事故中，唯一能救回数据的原因是旧账号库恰好还在。
 * 本脚本为生产库提供周期性异地备份，避免"两边同时坏 = 数据不可恢复"。
 *
 * 用法：node scripts/backup-d1-to-onedrive.mjs [--keep=8] [--dry]
 *
 * 凭据（本机用户环境变量，禁止写入仓库）：
 *   CF_MIGRATE_TARGET_GLOBAL_API_EMAIL / CF_MIGRATE_TARGET_GLOBAL_API_KEY  新账号（wrangler export 用）
 *   MORAN_OPENLIST_AUTH_TOKEN                                              OpenList/OneDrive 上传
 *   MORAN_OPENLIST_DIRECT_BASE_URL                                        默认 http://159.138.7.126:5244
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const DRY = process.argv.includes('--dry');
const keepArg = process.argv.find((arg) => arg.startsWith('--keep='));
const KEEP = Math.max(1, Number(keepArg ? keepArg.split('=')[1] : 8));

const DB_NAME = 'moranjianghu-db-backup';
const REMOTE_DIR = '/Onedrive/MoRanJiangHu/d1-backups';
const openlistBase = (process.env.MORAN_OPENLIST_DIRECT_BASE_URL || 'http://159.138.7.126:5244').replace(/\/+$/, '');
const token = process.env.MORAN_OPENLIST_AUTH_TOKEN || '';

if (!token) throw new Error('缺少 MORAN_OPENLIST_AUTH_TOKEN 环境变量。');
if (!process.env.CF_MIGRATE_TARGET_GLOBAL_API_EMAIL || !process.env.CF_MIGRATE_TARGET_GLOBAL_API_KEY) {
    throw new Error('缺少 CF_MIGRATE_TARGET_GLOBAL_API_EMAIL / CF_MIGRATE_TARGET_GLOBAL_API_KEY 环境变量。');
}

const stamp = new Date(Date.now() + 8 * 3600_000).toISOString().replace(/[-:.TZ]/g, '').slice(0, 12); // YYYYMMDDHHmm（北京时间）
const fileName = `${DB_NAME}-${stamp}.sql`;
const outputPath = path.join(os.tmpdir(), `msjh-d1-backup-${Date.now()}.sql`);

console.log(`[1/4] 导出 D1 ${DB_NAME} ...`);
execFileSync(process.execPath, [
    path.join(rootDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
    'd1', 'export', DB_NAME,
    '--config', 'wrangler.152.jsonc',
    '--remote',
    '--output', outputPath
], {
    cwd: rootDir,
    stdio: ['ignore', 'inherit', 'inherit'],
    timeout: 10 * 60 * 1000,
    env: {
        ...process.env,
        CLOUDFLARE_EMAIL: process.env.CF_MIGRATE_TARGET_GLOBAL_API_EMAIL,
        CLOUDFLARE_API_KEY: process.env.CF_MIGRATE_TARGET_GLOBAL_API_KEY
    }
});
const size = fs.statSync(outputPath).size;
console.log(`      导出完成：${fileName}（${(size / 1048576).toFixed(2)} MB）`);

const openlist = async (apiPath, body, method = 'POST') => {
    const res = await fetch(`${openlistBase}${apiPath}`, {
        method,
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(120_000)
    });
    const j = await res.json().catch(() => null);
    if (!j || j.code !== 200) throw new Error(`OpenList ${apiPath} 失败: ${JSON.stringify(j).slice(0, 200)}`);
    return j.data;
};

console.log('[2/4] 确保备份目录存在 ...');
await openlist('/api/fs/mkdir', { path: REMOTE_DIR });

if (!DRY) {
    console.log('[3/4] 上传备份到 OneDrive（PUT 直连源站）...');
    const uploadRes = await fetch(`${openlistBase}/api/fs/put`, {
        method: 'PUT',
        headers: {
            Authorization: token,
            'Content-Type': 'application/sql',
            'File-Path': encodeURIComponent(`${REMOTE_DIR}/${fileName}`)
        },
        body: fs.createReadStream(outputPath),
        signal: AbortSignal.timeout(10 * 60 * 1000),
        duplex: 'half'
    });
    const uploadJson = await uploadRes.json().catch(() => null);
    if (!uploadJson || uploadJson.code !== 200) {
        throw new Error(`上传失败: HTTP ${uploadRes.status} ${JSON.stringify(uploadJson).slice(0, 200)}`);
    }
    console.log('      上传完成。');

    const list = await openlist('/api/fs/list', { path: REMOTE_DIR, page: 1, per_page: 200 });
    const uploaded = (list.content || []).find((item) => item.name === fileName);
    if (!uploaded || uploaded.size !== size) {
        throw new Error(`上传校验失败：远端 ${uploaded ? uploaded.size : '缺失'} vs 本地 ${size}`);
    }
    console.log(`      校验通过（远端 ${uploaded.size} 字节）。`);

    const backups = (list.content || [])
        .filter((item) => !item.is_dir && new RegExp(`^${DB_NAME}-\\d{12}\\.sql$`).test(item.name))
        .sort((a, b) => a.name.localeCompare(b.name));
    const stale = backups.slice(0, Math.max(0, backups.length - KEEP));
    if (stale.length > 0) {
        await openlist('/api/fs/remove', { dir: REMOTE_DIR, names: stale.map((item) => item.name) });
        console.log(`[4/4] 清理旧备份 ${stale.length} 个，保留最近 ${KEEP} 份。`);
    } else {
        console.log(`[4/4] 当前共 ${backups.length} 份备份，无需清理。`);
    }
} else {
    console.log('[dry] 跳过上传与清理。');
}

fs.rmSync(outputPath, { force: true });
console.log('备份流程完成。');
