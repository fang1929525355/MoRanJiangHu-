# Cloudflare-VPS Migration Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 D1 中的账号、存档、创意工坊和诊断数据建立可追踪、幂等、零损坏的迁移事件基础，并为后续 PostgreSQL 复制器提供稳定协议。

**Architecture:** 第一阶段仍以 D1 为唯一权威，不改变正式请求路由。所有通过 `dbStore` 的写入在最终可见提交时原子追加迁移事件；大值采用版本化分块和原子清单指针切换，避免多批次中断破坏旧值。受签名保护的内部 API 只负责读取和确认事件，后续 VPS 复制器按序消费。

**Tech Stack:** TypeScript、Cloudflare Workers、D1、Web Crypto、Vitest、Wrangler

---

**Data safety target:** RPO = 0；任何已向用户返回成功的业务写入，必须同时具备可恢复的权威数据或迁移事件，不能依赖事后尽力补记。

## 计划边界与后续计划

完整迁移拆成四个可独立验收的实施计划：

1. 本计划：D1 迁移事件、版本化分块、内部复制协议和审计工具。
2. VPS 运行时计划：PostgreSQL、Valkey、Node API、Docker Compose、备份与内部签名。
3. 数据追平与接口迁移计划：快照导入、复制器、契约测试、影子读取和分接口切流。
4. 正式发布计划：双域名切换、APK、故障演练、版本发布、GitHub 备份与 CI 验证。

本计划不部署 VPS、不修改 DNS、不切换正式域名，也不改变玩家可见版本。

## 文件结构

- Create: `migrations/2026-07-26-vps-migration-outbox.sql`：D1 迁移事件和复制游标表。
- Create: `functions/api/_shared/migrationDigest.ts`：稳定序列化和 SHA-256。
- Create: `functions/api/_shared/migrationOutbox.ts`：事件创建、租约读取、确认和失败回退。
- Modify: `functions/api/_shared/dbStore.ts`：版本化分块、原子指针切换和可选 outbox。
- Create: `functions/api/migration/events.ts`：受 HMAC 保护的内部拉取与确认接口。
- Create: `functions/api/migration/status.ts`：不泄露数据内容的复制状态接口。
- Create: `scripts/audit-migration-outbox.mjs`：本地/远程 D1 只读审计。
- Modify: `package.json`：增加迁移和审计命令。
- Modify: `.dev.vars.example`：增加无真实值的迁移配置模板。
- Modify: `.env.production.example`：增加无真实值的迁移配置模板。
- Create: `__tests__/migrationDigest.test.ts`：摘要稳定性测试。
- Create: `__tests__/migrationOutbox.test.ts`：事件状态机和幂等确认测试。
- Create: `__tests__/dbStoreMigration.test.ts`：普通值、大值、覆盖和失败恢复测试。
- Create: `__tests__/migrationEventsApi.test.ts`：签名、租约和确认接口契约测试。

### Task 1: 建立迁移事件 D1 schema

**Files:**
- Create: `migrations/2026-07-26-vps-migration-outbox.sql`
- Modify: `package.json`

- [ ] **Step 1: 写入 D1 migration**

```sql
CREATE TABLE IF NOT EXISTS vps_migration_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  table_name TEXT NOT NULL,
  record_key TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('put', 'delete')),
  source_version TEXT,
  inline_value TEXT,
  value_sha256 TEXT,
  value_size INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'ready' CHECK (state IN ('ready', 'leased', 'acked', 'failed')),
  lease_owner TEXT,
  lease_expires_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  acked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_vps_migration_events_state_sequence
ON vps_migration_events(state, sequence);

CREATE INDEX IF NOT EXISTS idx_vps_migration_events_record
ON vps_migration_events(table_name, record_key, sequence);

CREATE TABLE IF NOT EXISTS vps_migration_consumers (
  consumer_id TEXT PRIMARY KEY,
  last_acked_sequence INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vps_migration_nonces (
  nonce TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vps_migration_nonces_expires
ON vps_migration_nonces(expires_at);
```

- [ ] **Step 2: 增加远程 migration 命令**

在 `package.json` 的 `scripts` 中加入：

```json
"db:migrate:vps-outbox": "wrangler d1 execute moranjianghu-db --remote --file migrations/2026-07-26-vps-migration-outbox.sql"
```

- [ ] **Step 3: 本地验证 SQL 可重复执行**

Run:

```powershell
npx wrangler d1 execute moranjianghu-db --local --file migrations/2026-07-26-vps-migration-outbox.sql
npx wrangler d1 execute moranjianghu-db --local --file migrations/2026-07-26-vps-migration-outbox.sql
```

Expected: 两次均成功，第二次不报告表或索引已存在错误。

- [ ] **Step 4: 提交 schema**

```powershell
git add migrations/2026-07-26-vps-migration-outbox.sql package.json
git commit -m "feat: add VPS migration outbox schema"
```

### Task 2: 建立稳定摘要工具

**Files:**
- Create: `functions/api/_shared/migrationDigest.ts`
- Create: `__tests__/migrationDigest.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex } from '../functions/api/_shared/migrationDigest';

describe('migrationDigest', () => {
  it('produces the same digest for objects with different key insertion order', async () => {
    const left = canonicalJson({ b: 2, a: { d: 4, c: 3 } });
    const right = canonicalJson({ a: { c: 3, d: 4 }, b: 2 });
    expect(left).toBe(right);
    expect(await sha256Hex(left)).toBe(await sha256Hex(right));
  });

  it('preserves array order and UTF-8 text', () => {
    expect(canonicalJson({ values: ['甲', '乙'] }))
      .not.toBe(canonicalJson({ values: ['乙', '甲'] }));
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
npx vitest run __tests__/migrationDigest.test.ts
```

Expected: FAIL，提示模块或导出不存在。

- [ ] **Step 3: 实现稳定序列化和摘要**

```ts
const normalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)])
    );
  }
  return value;
};

export const canonicalJson = (value: unknown): string =>
  JSON.stringify(normalize(value));

export const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
};
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```powershell
npx vitest run __tests__/migrationDigest.test.ts
```

Expected: 2 tests passed。

- [ ] **Step 5: 提交摘要工具**

```powershell
git add functions/api/_shared/migrationDigest.ts __tests__/migrationDigest.test.ts
git commit -m "feat: add canonical migration digests"
```

### Task 3: 实现 outbox 状态机

**Files:**
- Create: `functions/api/_shared/migrationOutbox.ts`
- Create: `__tests__/migrationOutbox.test.ts`

- [ ] **Step 1: 写失败测试覆盖事件准备、租约和幂等确认**

测试文件内实现 `createMigrationD1Mock()`，只模拟本任务使用的 `prepare().bind().run()/all()/first()` 与 `batch()`，并公开 `event(eventId)` 及 `events()` 供断言。mock 的 `batch()` 必须先在克隆状态执行全部 statement，任一 statement 抛错时不修改原状态，以模拟 D1 原子 batch。随后验证以下行为：

```ts
it('leases ready events in sequence order and acknowledges idempotently', async () => {
  const db = createMigrationD1Mock();
  await insertReadyEvent(db, {
    eventId: 'evt-1', tableName: 'cloud_play_data', recordKey: 'save/1',
    operation: 'put', sourceVersion: null, inlineValue: '{"ok":true}',
    valueSha256: 'hash-1', valueSize: 11, createdAt: '2026-07-26T00:00:00.000Z'
  });

  const leased = await leaseEvents(db, { consumerId: 'vps-primary', limit: 50, now: '2026-07-26T00:01:00.000Z' });
  expect(leased.map(event => event.eventId)).toEqual(['evt-1']);
  expect(leased[0].state).toBe('leased');

  await acknowledgeEvents(db, { consumerId: 'vps-primary', eventIds: ['evt-1'], now: '2026-07-26T00:02:00.000Z' });
  await acknowledgeEvents(db, { consumerId: 'vps-primary', eventIds: ['evt-1'], now: '2026-07-26T00:02:00.000Z' });
  expect(db.event('evt-1')?.state).toBe('acked');
});
```

另加测试：过期租约重新变为可租用；其他 consumer 不能确认未持有的租约；失败信息截断为 1000 字符；`limit` 被限制在 1–100。

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
npx vitest run __tests__/migrationOutbox.test.ts
```

Expected: FAIL，`migrationOutbox` 和 D1 mock 尚不存在。

- [ ] **Step 3: 定义事件类型和 SQL 操作**

`migrationOutbox.ts` 必须导出：

```ts
export type MigrationOperation = 'put' | 'delete';
export type MigrationEventInput = {
  eventId: string;
  tableName: string;
  recordKey: string;
  operation: MigrationOperation;
  sourceVersion: string | null;
  inlineValue: string | null;
  valueSha256: string | null;
  valueSize: number;
  createdAt: string;
};

export const prepareEventStatement = (db: any, event: MigrationEventInput): any =>
  db.prepare(`INSERT INTO vps_migration_events
    (event_id, table_name, record_key, operation, source_version, inline_value,
     value_sha256, value_size, state, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?)`)
    .bind(event.eventId, event.tableName, event.recordKey, event.operation,
      event.sourceVersion, event.inlineValue, event.valueSha256,
      event.valueSize, event.createdAt);
```

同时实现 `leaseEvents`、`acknowledgeEvents` 和 `failEvents`。租用操作必须使用带条件的单条 `UPDATE ... RETURNING`，只更新当前为 `ready` 或租约已过期的行，避免两个 consumer 同时取走同一事件；返回结果按 `sequence ASC`。确认操作的 WHERE 条件必须同时匹配 `event_id`、`lease_owner` 和 `state='leased'`。

- [ ] **Step 4: 运行状态机测试**

Run:

```powershell
npx vitest run __tests__/migrationOutbox.test.ts
```

Expected: 全部测试通过。

- [ ] **Step 5: 提交状态机**

```powershell
git add functions/api/_shared/migrationOutbox.ts __tests__/migrationOutbox.test.ts
git commit -m "feat: add migration outbox state machine"
```

### Task 4: 让 dbStore 写入具备原子可见性

**Files:**
- Modify: `functions/api/_shared/dbStore.ts`
- Create: `__tests__/dbStoreMigration.test.ts`

- [ ] **Step 1: 写普通值原子事件失败测试**

```ts
it('commits a small value and its migration event in one batch', async () => {
  const db = createDbStoreD1Mock();
  const bucket = getDbBucket(db, 'cloud_play_data', { migrationOutbox: true });

  await bucket.put('save/1', JSON.stringify({ value: 1 }));

  expect(db.batchCalls).toHaveLength(1);
  expect(await bucket.get('save/1').then(value => value?.json())).toEqual({ value: 1 });
  expect(db.readyEvents()).toHaveLength(1);
  expect(db.readyEvents()[0]).toMatchObject({
    table_name: 'cloud_play_data', record_key: 'save/1', operation: 'put'
  });
});
```

- [ ] **Step 2: 写大值失败恢复测试**

```ts
it('keeps the previous value visible when a versioned chunk upload fails before pointer swap', async () => {
  const db = createDbStoreD1Mock();
  const bucket = getDbBucket(db, 'cloud_play_data', { migrationOutbox: true });
  await bucket.put('save/large', JSON.stringify({ revision: 1 }));

  db.failNextChunkBatch();
  await expect(bucket.put('save/large', JSON.stringify({ revision: 2, text: '甲'.repeat(900_000) }))).rejects.toThrow();

  expect(await bucket.get('save/large').then(value => value?.json())).toEqual({ revision: 1 });
  expect(db.readyEvents().filter(event => event.record_key === 'save/large')).toHaveLength(1);
});
```

另加测试：覆盖大值后读取新版本；旧版清单兼容；删除与事件同批提交；列表隐藏旧 `::chunk-N` 和新 `::version-ID::chunk-N`；outbox 关闭时保持原行为。

- [ ] **Step 3: 运行测试确认失败**

Run:

```powershell
npx vitest run __tests__/dbStoreMigration.test.ts
```

Expected: FAIL，因为 `getDbBucket` 尚不接受迁移选项，且旧分块会先删除当前版本。

- [ ] **Step 4: 扩展清单格式与分块键**

将内部清单扩展为向后兼容结构：

```ts
type ChunkManifest = {
  _chunked: true;
  chunks: number;
  totalSize: number;
  version?: string;
};

const chunkKey = (baseKey: string, index: number, version?: string): string =>
  version
    ? `${baseKey}::version-${version}::chunk-${index}`
    : `${baseKey}::chunk-${index}`;
```

读取旧清单时继续使用旧键；读取带 `version` 的清单时只读取对应版本键。列表过滤规则同时识别两种内部键。

- [ ] **Step 5: 实现 copy-on-write 大值提交**

大值写入顺序固定为：

1. 生成 `eventId`，将所有新块写到版本化键。
2. 任意块批次失败时抛错，旧清单不变，新块不可见。
3. 最终单个 D1 batch 同时提交新清单行和 outbox 事件。
4. 提交成功后尽力清理旧版本块；清理失败只产生孤立块，不影响读取或复制。

事件不重复保存大值正文，而是写入 `source_version=eventId`、摘要和总大小。小值把不可变正文保存在 `inline_value` 中，防止同一 key 后续覆盖导致复制器读到错误版本。

- [ ] **Step 6: 通过环境开关接入现有调用方**

保留 `getDbBucket(db, tableName)` 兼容签名，并增加：

```ts
export type DbBucketOptions = { migrationOutbox?: boolean };

export const tryDbBucket = (env: any, tableName: string): R2LikeBucket | null => {
  const db = env?.DB;
  if (!db || typeof db.prepare !== 'function') return null;
  return getDbBucket(db, tableName, {
    migrationOutbox: env?.VPS_MIGRATION_OUTBOX_ENABLED === 'true'
  });
};
```

开关默认关闭。只有 migration 执行、测试及远程 schema 验证完成后才允许在 Cloudflare 设置为 `true`。

- [ ] **Step 7: 运行相关测试**

Run:

```powershell
npx vitest run __tests__/dbStoreMigration.test.ts __tests__/creativeWorkshopModulesApi.test.ts __tests__/workshopNovelDecompositionApi.test.ts
```

Expected: 全部通过；现有创意工坊行为没有变化。

- [ ] **Step 8: 提交原子写入改造**

```powershell
git add functions/api/_shared/dbStore.ts __tests__/dbStoreMigration.test.ts
git commit -m "feat: journal D1 mutations for VPS replication"
```

### Task 5: 建立 HMAC 内部复制协议

**Files:**
- Create: `functions/api/migration/events.ts`
- Create: `functions/api/migration/status.ts`
- Create: `__tests__/migrationEventsApi.test.ts`
- Modify: `.dev.vars.example`
- Modify: `.env.production.example`

- [ ] **Step 1: 写签名失败测试**

测试固定时间和 nonce，构造以下规范串：

```text
GET
/api/migration/events?consumer=vps-primary&limit=50
1785052800
nonce-test-1
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

验证：缺少签名返回 401；时间偏差超过 60 秒返回 401；错误签名返回 403；重复 nonce 返回 409；有效签名返回按序事件且不包含密钥。

- [ ] **Step 2: 写确认接口失败测试**

```ts
it('acknowledges only the signed consumer lease', async () => {
  const response = await onRequestPost({
    request: signedRequest('/api/migration/events', {
      consumerId: 'vps-primary', eventIds: ['evt-1'], action: 'ack'
    }),
    env: createMigrationEnv()
  });
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({ ok: true, acknowledged: 1 });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```powershell
npx vitest run __tests__/migrationEventsApi.test.ts
```

Expected: FAIL，两个 migration API 文件尚不存在。

- [ ] **Step 4: 实现请求验证和 API**

环境变量：

```text
VPS_MIGRATION_HMAC_SECRET=
VPS_MIGRATION_OUTBOX_ENABLED=false
```

GET `/api/migration/events` 租用事件；POST 同一路径只接受 `ack` 或 `fail`。`/api/migration/status` 返回 ready、leased、failed、最老 ready 时间和最大 sequence，不返回 `inline_value`、业务 key 或密钥。

nonce 记录在 D1 独立表中，并设置过期清理；不能依赖单个 Worker isolate 的内存集合。

- [ ] **Step 5: 运行 API 测试**

Run:

```powershell
npx vitest run __tests__/migrationEventsApi.test.ts __tests__/migrationOutbox.test.ts
```

Expected: 全部通过。

- [ ] **Step 6: 提交内部协议**

```powershell
git add functions/api/migration/events.ts functions/api/migration/status.ts __tests__/migrationEventsApi.test.ts .dev.vars.example .env.production.example
git commit -m "feat: expose signed migration event protocol"
```

### Task 6: 增加只读审计与全量验证

**Files:**
- Create: `scripts/audit-migration-outbox.mjs`
- Modify: `package.json`

- [ ] **Step 1: 实现审计脚本**

脚本只执行 SELECT，并输出 JSON：

```json
{
  "total": 0,
  "ready": 0,
  "leased": 0,
  "acked": 0,
  "failed": 0,
  "oldestReadyAt": null,
  "maxSequence": 0,
  "invalidRows": 0
}
```

`invalidRows` 统计缺少摘要的 put、带正文的 delete、未知表名、负数大小和缺少时间的事件。脚本不得打印 `inline_value`、record key、账号或存档内容。

- [ ] **Step 2: 增加脚本命令**

```json
"migration:audit:local": "node scripts/audit-migration-outbox.mjs --local",
"migration:audit:remote": "node scripts/audit-migration-outbox.mjs --remote"
```

- [ ] **Step 3: 运行本地审计**

Run:

```powershell
npm run migration:audit:local
```

Expected: 退出码 0，输出合法 JSON，`invalidRows` 为 0。

- [ ] **Step 4: 运行第一阶段完整验证**

Run:

```powershell
npx vitest run __tests__/migrationDigest.test.ts __tests__/migrationOutbox.test.ts __tests__/dbStoreMigration.test.ts __tests__/migrationEventsApi.test.ts __tests__/creativeWorkshopModulesApi.test.ts __tests__/workshopNovelDecompositionApi.test.ts
npm run worker:functions
rg -n "vps_migration_events|VPS_MIGRATION_OUTBOX_ENABLED" .tmp-worker-build/index.js
npm run build
git diff --check
```

Expected:

- 所列测试全部通过。
- Worker functions 构建成功。
- 新标识存在于实际 Worker bundle。
- 前端生产构建成功。
- `git diff --check` 无输出。

- [ ] **Step 5: 提交审计工具**

```powershell
git add scripts/audit-migration-outbox.mjs package.json
git commit -m "chore: add migration outbox audit"
```

### Task 7: 第一阶段安全启用门槛

**Files:**
- Modify: `docs/superpowers/plans/2026-07-26-migration-foundation.md`（仅勾选执行结果与记录证据）

本任务的所有步骤都会读取或改变远程环境，只能在用户明确说“部署”“发布”或“上线”后执行。完成 Task 1–6 的本地代码不构成远程操作授权。

- [ ] **Step 1: 创建 D1 远程备份**

使用 Wrangler 导出远程 D1 到明确的本地临时备份目录，记录文件大小与 SHA-256。备份文件不得提交 Git。

- [ ] **Step 2: 执行远程 schema migration**

Run:

```powershell
npm run db:migrate:vps-outbox
```

Expected: migration 成功，现有业务表未被修改或删除。

- [ ] **Step 3: 保持 outbox 开关关闭并部署代码**

此步骤属于公开 Worker 部署，必须遵守版本递增、`releasePublishedAt`、`main` 备份提交、推送和双域名验证规则。仅“开始实施”不等于授权此公开部署。

- [ ] **Step 4: 先在受控测试数据上启用 outbox**

设置 `VPS_MIGRATION_OUTBOX_ENABLED=true` 前确认 HMAC Secret 已分别写入 Cloudflare Secret 和未来 VPS 密钥环境。启用后仅使用隔离测试账号执行一次小存档写入、一次覆盖和一次删除。

- [ ] **Step 5: 审计测试事件**

Run:

```powershell
npm run migration:audit:remote
```

Expected: `invalidRows=0`，三次操作均有按序事件，业务读取结果与最终操作一致。

- [ ] **Step 6: 停在第二阶段计划门槛**

第一阶段只证明 D1 能可靠产生迁移事件。没有 PostgreSQL 复制器、全量校验和回退演练前，不得把任何正式 API 切换到 VPS。

## 第一阶段完成定义

- D1 schema 可重复应用且已先备份。
- 小值写入与 outbox 事件原子提交。
- 大值失败不会破坏旧版本或产生 ready 事件。
- 删除、覆盖和分块版本均可被复制器唯一识别。
- 内部事件接口具备时间窗、HMAC、nonce 防重放和租约所有权保护。
- 审计输出不包含用户数据或密钥。
- 全部相关测试、Worker bundle 和前端构建通过。
- 未切换正式 API，未声称 VPS 已成为主库。
