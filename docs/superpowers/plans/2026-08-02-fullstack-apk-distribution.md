# Fullstack Cloud APK Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 OpenList 的“全栈云盘”接入 APK 自动更新主下载链路，同时修复客户端用 HEAD 延迟误判下载速度和低速源切换过慢的问题。

**Architecture:** Worker 新增 `fullstack` provider，每次请求通过 OpenList API 获取当前签名并 302 到 `/全栈云盘/MoRanJiangHu/...`。更新清单把全栈云盘排在首位，客户端严格遵循清单顺序，Android 原生下载器基于真实字节吞吐快速切换慢源。发布脚本复用现有 OpenList 上传实现，将 APK 同步到全栈云盘，但本任务不执行上传或部署。

**Tech Stack:** TypeScript、Cloudflare Pages Functions/Workers、Vitest、Node.js 发布脚本、Java/Capacitor Android、Gradle。

---

## 文件结构

- `functions/api/apk/_shared.ts`：OpenList 文件签名获取与全栈云盘 302 构造。
- `functions/api/apk/_providerRouter.ts`：注册 `fullstack` provider 并设为默认首选。
- `functions/api/apk/latest.json.ts`：向客户端发布全栈云盘地址和稳定候选顺序。
- `services/appUpdate.ts`：保留清单候选顺序，不再用 HEAD 延迟重新排序。
- `android/app/src/main/java/com/moranjianghu/game/ApkUpdaterPlugin.java`：调整真实吞吐低速判定。
- `scripts/upload-apk-onedrive.mjs`：将现有 OpenList 上传/验证函数参数化，以支持不同挂载目录。
- `scripts/upload-apk-fullstack.mjs`：全栈云盘 APK 上传入口。
- `scripts/publish-release-b2.mjs`：发布流程生成全栈云盘 URL，并在明确发布时调用上传。
- `scripts/benchmark-apk-providers.mjs`：真实下载基准加入全栈云盘。
- `package.json`：增加全栈云盘上传命令。
- `__tests__/apkFullstackRedirect.test.ts`：全栈云盘动态签名与路由测试。
- `__tests__/apkLatestManifest.test.ts`：更新清单顺序测试。
- `__tests__/appUpdate.test.ts`：客户端保持清单顺序与失败回退测试。

### Task 1: 全栈云盘 Worker provider

**Files:**
- Create: `__tests__/apkFullstackRedirect.test.ts`
- Modify: `functions/api/apk/_shared.ts`
- Modify: `functions/api/apk/_providerRouter.ts`

- [ ] **Step 1: 写失败测试**

测试调用 `buildFullstackApkRedirect(env, 'latest.apk', 'MoRanJiangHu-v1.0.633.apk')`，模拟 OpenList `/api/fs/get` 返回 `{ code: 200, data: { sign: 'signed-token' } }`，断言响应为 302，`Location` 为编码后的 `/d/全栈云盘/MoRanJiangHu/apk/latest.apk?sign=signed-token`，且 `X-Moran-Apk-Source` 为 `fullstack`。再通过 `latest.apk` handler 验证 `provider=fullstack` 会选择该路由。

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm run test:run -- __tests__/apkFullstackRedirect.test.ts`

Expected: FAIL，原因是 `buildFullstackApkRedirect` 或 `fullstack` provider 尚不存在。

- [ ] **Step 3: 最小实现**

在 `_shared.ts` 中新增：

```ts
const FULLSTACK_APK_ROOT = '/全栈云盘/MoRanJiangHu';

export const buildFullstackApkRedirect = async (
    env: any,
    storageFileName: string,
    downloadFileName: string,
    cacheControl = APK_LATEST_CACHE_CONTROL
): Promise<Response | null> => {
    const directory = storageFileName === 'latest.apk'
        ? `${FULLSTACK_APK_ROOT}/apk`
        : `${FULLSTACK_APK_ROOT}/releases`;
    const sign = await fetchOpenListFileSign(env, directory, storageFileName);
    if (!sign) return null;
    const location = `${readOpenListPublicBaseUrl(env)}/d${directory}/${encodeURIComponent(storageFileName)}?sign=${encodeURIComponent(sign)}`;
    return new Response(null, {
        status: 302,
        headers: {
            Location: location,
            'Content-Type': 'application/vnd.android.package-archive',
            'Content-Disposition': `attachment; filename="${downloadFileName}"`,
            'Cache-Control': cacheControl,
            'X-Moran-Apk-Source': 'fullstack',
            ...APK_CORS_HEADERS
        }
    });
};
```

在 `_providerRouter.ts` 中把 `fullstack` 加入 `ResolvedApkProvider`、默认顺序和响应构造分支。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm run test:run -- __tests__/apkFullstackRedirect.test.ts __tests__/apkOneDriveRedirect.test.ts __tests__/apkQuarkTvRedirect.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add __tests__/apkFullstackRedirect.test.ts functions/api/apk/_shared.ts functions/api/apk/_providerRouter.ts
git commit -m "feat: add fullstack apk provider"
```

### Task 2: 更新清单与客户端候选顺序

**Files:**
- Modify: `__tests__/apkLatestManifest.test.ts`
- Modify: `__tests__/appUpdate.test.ts`
- Modify: `functions/api/apk/latest.json.ts`
- Modify: `services/appUpdate.ts`

- [ ] **Step 1: 写失败测试**

在清单测试中断言：

```ts
expect(payload.latest.fullstackApkUrl).toBe(
    'https://msjh.bacon159.pp.ua/api/apk/latest.apk?provider=fullstack'
);
expect(payload.latest.apkUrls[0]).toBe(payload.latest.fullstackApkUrl);
expect(payload.latest.apkUrls.some((url: string) => url.includes('115open'))).toBe(false);
```

在客户端测试中让第二个 URL 的 HEAD 响应更快，但断言 `downloadAndInstall` 仍先调用清单中的第一个 URL；第一个下载抛错后才调用第二个 URL。

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm run test:run -- __tests__/apkLatestManifest.test.ts __tests__/appUpdate.test.ts`

Expected: FAIL，清单没有全栈云盘地址，客户端仍会按 HEAD 延迟重排。

- [ ] **Step 3: 最小实现**

在 `latest.json.ts` 中新增：

```ts
const fullstackApkUrl = `${baseUrl}/api/apk/latest.apk?provider=fullstack`;
const fullstackGroup = [fullstackApkUrl];
```

无论旧清单的 `preferredApkProvider` 是什么，公开候选列表首先放 `fullstackGroup`，后续保留 VPS、夸克、GitHub、OneDrive 兜底；payload 写入 `fullstackApkUrl`。在 `appUpdate.ts` 删除 `probeAndSortUrlsByLatency`，直接使用 `resolveNativeApkDownloadUrls(manifest)` 的去重结果。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm run test:run -- __tests__/apkLatestManifest.test.ts __tests__/appUpdate.test.ts`

Expected: PASS，且测试中没有 APK 候选 HEAD 请求。

- [ ] **Step 5: 提交**

```bash
git add __tests__/apkLatestManifest.test.ts __tests__/appUpdate.test.ts functions/api/apk/latest.json.ts services/appUpdate.ts
git commit -m "fix: preserve apk provider throughput order"
```

### Task 3: Android 真实吞吐慢速切源

**Files:**
- Modify: `android/app/src/main/java/com/moranjianghu/game/ApkUpdaterPlugin.java`

- [ ] **Step 1: 建立可验证断言**

创建 `__tests__/apkUpdaterSource.test.ts`，读取 Java 源码并断言常量为：

```java
private static final long MIN_SPEED_BYTES_PER_SEC = 128L * 1024L;
private static final int MAX_SLOW_CHECKS = 2;
```

测试同时断言源码仍包含删除残缺 APK 和抛出 `SlowDownloadException` 的分支，保证后续修改不会退回 30 KB/s/15 秒或移除自动切源。

- [ ] **Step 2: 运行断言并确认失败**

Run: `npm run test:run -- __tests__/apkUpdaterSource.test.ts`

Expected: FAIL，当前值为 30 KB/s 和 3 个窗口。

- [ ] **Step 3: 最小实现**

修改 Java 常量为 128 KB/s 和两个 5 秒窗口，保留已有删除残缺 APK、抛出 `SlowDownloadException`、上层尝试下一 URL 的行为。

- [ ] **Step 4: 运行测试和 Android 编译检查**

Run: `npm run test:run -- __tests__/apkUpdaterSource.test.ts`

Run: `node scripts/run-gradle.mjs compileDebugJavaWithJavac`

Expected: 两条命令均成功。

- [ ] **Step 5: 提交**

```bash
git add __tests__/apkUpdaterSource.test.ts android/app/src/main/java/com/moranjianghu/game/ApkUpdaterPlugin.java
git commit -m "fix: switch slow apk sources sooner"
```

### Task 4: 全栈云盘上传与发布元数据

**Files:**
- Create: `scripts/upload-apk-fullstack.mjs`
- Create: `__tests__/uploadApkFullstack.test.ts`
- Modify: `scripts/upload-apk-onedrive.mjs`
- Modify: `scripts/publish-release-b2.mjs`
- Modify: `scripts/benchmark-apk-providers.mjs`
- Modify: `package.json`

- [ ] **Step 1: 写失败测试**

导入新的全栈上传配置构造函数并断言：

```ts
expect(buildFullstackUploadTargets('1.0.633')).toEqual([
  '/全栈云盘/MoRanJiangHu/apk/latest.apk',
  '/全栈云盘/MoRanJiangHu/releases/MoRanJiangHu-v1.0.633.apk'
]);
```

同时断言发布清单的 `preferredApkProvider` 为 `fullstack`，provider URL 为网站的 `provider=fullstack` 地址，且没有 `115open`。

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm run test:run -- __tests__/uploadApkFullstack.test.ts`

Expected: FAIL，脚本和目标构造函数尚不存在。

- [ ] **Step 3: 最小实现**

将 `upload-apk-onedrive.mjs` 的上传函数保持向后兼容，并允许调用方传入任意 OpenList 目标路径。新脚本导出：

```js
export const buildFullstackUploadTargets = (versionName) => [
  '/全栈云盘/MoRanJiangHu/apk/latest.apk',
  `/全栈云盘/MoRanJiangHu/releases/MoRanJiangHu-v${versionName}.apk`
];
```

命令行执行时读取现有 release APK、`MORAN_OPENLIST_AUTH_TOKEN` 和 OpenList base URL，依次上传并通过 `/api/fs/get` 验证大小。`publish-release-b2.mjs` 在正式发布流程中调用该函数，生成 `fullstack` 清单字段；`benchmark-apk-providers.mjs` 加入 `provider=fullstack`；`package.json` 增加：

```json
"release:fullstack": "node scripts/upload-apk-fullstack.mjs"
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm run test:run -- __tests__/uploadApkFullstack.test.ts __tests__/apkLatestManifest.test.ts`

Expected: PASS。

- [ ] **Step 5: 只做脚本 dry-run/参数检查**

Run: `node scripts/upload-apk-fullstack.mjs --help`

Expected: 输出目标路径和所需环境变量说明，不上传文件。

- [ ] **Step 6: 提交**

```bash
git add scripts/upload-apk-fullstack.mjs scripts/upload-apk-onedrive.mjs scripts/publish-release-b2.mjs scripts/benchmark-apk-providers.mjs package.json __tests__/uploadApkFullstack.test.ts
git commit -m "feat: prepare fullstack apk publishing"
```

### Task 5: 回归验证与客户说明

**Files:**
- Modify only if verification reveals a defect in files already covered above.

- [ ] **Step 1: 运行 APK 分发相关测试**

Run: `npm run test:run -- __tests__/apkFullstackRedirect.test.ts __tests__/apkLatestManifest.test.ts __tests__/appUpdate.test.ts __tests__/apkUpdaterSource.test.ts __tests__/uploadApkFullstack.test.ts __tests__/apkOneDriveRedirect.test.ts __tests__/apkQuarkTvRedirect.test.ts`

Expected: PASS。

- [ ] **Step 2: 运行 TypeScript 与 Web 构建验证**

Run: `npx tsc --noEmit`

Run: `npm run build`

Expected: PASS，并生成本地 `dist`；不部署。

- [ ] **Step 3: 运行 Android Java 编译验证**

Run: `node scripts/run-gradle.mjs compileDebugJavaWithJavac`

Expected: BUILD SUCCESSFUL。

- [ ] **Step 4: 检查工作区与发布边界**

Run: `git status --short`

Expected: 只包含本任务文件和用户原有未提交文件；没有 APK、日志、截图、测试输出或部署产物被加入提交。

不得执行 `wrangler deploy`、正式 OpenList 上传、版本号更新或 APK 发布。
