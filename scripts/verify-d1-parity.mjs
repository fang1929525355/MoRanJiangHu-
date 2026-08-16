/**
 * verify-d1-parity.mjs
 *
 * 对比两个 Cloudflare D1 数据库的业务表一致性：行数、键集合、同键 updated_at。
 * 用途：账号迁移 / 数据库复制 / 手工同步之后，验证目标库没有出现"残缺快照"
 * （2026-08-16 创意工坊清空事故的直接教训：迁移只复制了 manifest 行、漏掉 chunk 行）。
 *
 * 用法：
 *   node scripts/verify-d1-parity.mjs                        # 默认对比 旧账号 moranjianghu-db vs 新账号 moranjianghu-db-backup
 *   node scripts/verify-d1-parity.mjs --fail-on-diff         # 发现差异时以非零退出码结束（可接入发布流程）
 *
 * 凭据（本机用户环境变量，禁止写入仓库）：
 *   旧账号：CLOUDFLARE_EMAIL + CLOUDFLARE_API_KEY
 *   新账号：CF_MIGRATE_TARGET_GLOBAL_API_EMAIL + CF_MIGRATE_TARGET_GLOBAL_API_KEY
 */

const DEFAULT_TABLES = [
    'workshop_data',
    'workshop_novel_data',
    'cloud_play_data',
    'diagnostic_reports',
    'online_hourly_history',
    'apk_download_daily'
];

const OLD_DB = { account: 'af087b3ace8e434ac24273df5b8b9e51', id: '0a9c1910-5203-4e7e-a425-e600dc56a6af', label: 'old/moranjianghu-db' };
const NEW_DB = { account: '5d34b67de994f61284cd81176d6f1382', id: 'd72fe8c8-c46d-4e16-9594-67beaeab7592', label: 'new/moranjianghu-db-backup' };

const FAIL_ON_DIFF = process.argv.includes('--fail-on-diff');

const conn = (db) => ({
    ...db,
    email: db === OLD_DB ? process.env.CLOUDFLARE_EMAIL : process.env.CF_MIGRATE_TARGET_GLOBAL_API_EMAIL,
    key: db === OLD_DB ? process.env.CLOUDFLARE_API_KEY : process.env.CF_MIGRATE_TARGET_GLOBAL_API_KEY
});

async function query(c, sql) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${c.account}/d1/database/${c.id}/query`, {
                method: 'POST',
                headers: { 'X-Auth-Email': c.email, 'X-Auth-Key': c.key, 'Content-Type': 'application/json' },
                body: JSON.stringify({ sql }),
                signal: AbortSignal.timeout(60_000)
            });
            const j = await res.json();
            if (!j.success) throw new Error(`D1 query failed on ${c.label}: ${JSON.stringify(j.errors)}`);
            return j.result[0].results;
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
        }
    }
    throw lastError;
}

const hasValueColumn = (table) => table !== 'apk_download_daily';
const keyColumns = (table) => (table === 'apk_download_daily' ? "day || '|' || version_name || '|' || provider" : 'key');

async function loadTable(c, table) {
    const k = keyColumns(table);
    const cols = hasValueColumn(table) ? `${k} AS k, updated_at` : `${k} AS k, updated_at`;
    const rows = await query(c, `SELECT ${cols} FROM ${table}`);
    return new Map(rows.map((r) => [r.k, r.updated_at]));
}

let foundDiff = false;

for (const table of DEFAULT_TABLES) {
    const [a, b] = await Promise.all([loadTable(conn(OLD_DB), table), loadTable(conn(NEW_DB), table)]);
    const onlyA = [...a.keys()].filter((k) => !b.has(k));
    const onlyB = [...b.keys()].filter((k) => !a.has(k));
    const newerB = [...a.keys()].filter((k) => b.has(k) && String(b.get(k)) > String(a.get(k)));
    const newerA = [...b.keys()].filter((k) => a.has(k) && String(a.get(k)) > String(b.get(k)));
    const problem = onlyA.length > 0 || onlyB.length > 0;

    // 说明：onlyB / newerB 属于"目标库有更新数据"，对单向同步是正常现象；
    // onlyA 表示源库有而目标库没有 —— 复制/迁移不完整的核心信号。
    if (problem) foundDiff = true;
    console.log(`\n== ${table}`);
    console.log(`   old=${a.size} new=${b.size}`);
    if (onlyA.length > 0) {
        console.log(`   ❌ 仅存在于旧库的键 ${onlyA.length} 个（迁移残缺信号，前 10 个）：`);
        onlyA.slice(0, 10).forEach((k) => console.log(`      - ${k}`));
    }
    if (onlyB.length > 0) console.log(`   ℹ️  仅存在于新库的键 ${onlyB.length} 个（新库新写入，正常）`);
    if (newerB.length > 0) console.log(`   ℹ️  新库 updated_at 更新的键 ${newerB.length} 个（新库新写入，正常）`);
    if (newerA.length > 0) console.log(`   ⚠️  旧库 updated_at 更新的键 ${newerA.length} 个（若预期单向同步则为异常）`);
    if (!problem && newerA.length === 0) console.log('   ✅ 一致');
}

console.log('');
if (foundDiff) {
    console.log('结论：发现仅存在于旧库的键，目标库可能是不完整副本 —— 请先运行同步/导出修复，再对外切流量。');
    if (FAIL_ON_DIFF) process.exit(1);
} else {
    console.log('结论：未发现迁移残缺信号。');
}
