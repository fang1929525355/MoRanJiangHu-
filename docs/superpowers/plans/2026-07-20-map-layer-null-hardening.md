# 地图层级空值根治与 v1.0.622 发布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清除 `世界.地图层级` 中的非法成员，阻止提示词构建空指针崩溃，并在完整验证后发布 v1.0.622。

**Architecture:** 将数据不变量放在 `规范化世界状态`：只保留具有地图语义的普通对象；同时在系统提示词摘要边界再次筛选，避免未归一化输入击穿剧情流程。测试先复现两个失败路径，再进行最小实现，最后通过真实存档浏览器流程和完整发布面验证。

**Tech Stack:** TypeScript、React、Vitest、Vite、Playwright/浏览器自动化、Capacitor Android、Gradle、Cloudflare Wrangler、OneDrive/OpenList、GitHub CLI。

---

### Task 1: 建立失败回归测试

**Files:**
- Create: `__tests__/mapLayerNullHardening.test.ts`
- Test: `hooks/useGame/storyState.ts`
- Test: `hooks/useGame/systemPromptBuilder.ts`

- [ ] **Step 1: 编写世界状态清洗失败测试**

测试输入包含合法节点、`null`、原始值、数组和空对象；断言输出只保留合法对象，并保持合法对象顺序和扩展字段。

- [ ] **Step 2: 编写提示词边界失败测试**

调用真实 `构建系统提示词`，传入包含 `null` 的 `世界.地图层级`，断言不会抛错，地图摘要只包含合法节点且节点计数正确。

- [ ] **Step 3: 运行测试并确认 RED**

Run: `npm run test:run -- __tests__/mapLayerNullHardening.test.ts`

Expected: 至少一个测试因当前 `null.层级` TypeError 或未过滤非法成员而失败。

### Task 2: 最小根因修复

**Files:**
- Modify: `hooks/useGame/storyState.ts:1924`
- Modify: `hooks/useGame/systemPromptBuilder.ts:965-974`
- Test: `__tests__/mapLayerNullHardening.test.ts`

- [ ] **Step 1: 在状态入口筛选有效地图节点**

加入局部判定函数或等价逻辑：值必须是非空、非数组对象，且 `ID`、`名称`、`层级` 至少一个为非空字符串。合法对象原样保留。

- [ ] **Step 2: 在提示词边界筛选并安全读取**

从原始数组生成 `validLayers`，忽略非法值，使用安全访问构建摘要，并用有效节点数量输出统计。

- [ ] **Step 3: 运行目标测试并确认 GREEN**

Run: `npm run test:run -- __tests__/mapLayerNullHardening.test.ts`

Expected: 所有目标测试通过。

- [ ] **Step 4: 反向验证回归测试有效性**

临时还原生产修复，确认目标测试重新失败；恢复修复后再次运行并通过。临时还原不提交。

### Task 3: 扩展自动化回归验证

**Files:**
- Verify: `__tests__/mapLayerNullHardening.test.ts`
- Verify: `__tests__/mapE2E.test.ts`
- Verify: `__tests__/mapUpdateWorkflow.test.ts`
- Verify: `__tests__/worldbookSystemPrompt.test.ts`

- [ ] **Step 1: 运行地图与提示词相关测试**

Run: `npm run test:run -- __tests__/mapLayerNullHardening.test.ts __tests__/mapE2E.test.ts __tests__/mapUpdateWorkflow.test.ts __tests__/worldbookSystemPrompt.test.ts`

Expected: 全部通过，0 failures。

- [ ] **Step 2: 运行完整测试套件**

Run: `npm run test:run`

Expected: 全部通过，0 failures。

- [ ] **Step 3: 运行生产构建**

Run: `npm run build`

Expected: Vite 构建退出码 0，生成新的 `dist` 静态资源。

### Task 4: 真实存档与浏览器端到端验证

**Files:**
- Runtime fixture: `.tmp-release-assets/WuXia_Save_Data.zip`（若存在）
- Verify: `services/dbService.ts`
- Verify: `hooks/useGame/saveLoad/saveLoadWorkflow.ts`
- Verify: `hooks/useGame/systemPromptBuilder.ts`

- [ ] **Step 1: 启动本地静态预览**

使用隐藏后台进程启动 `python -m http.server 4173 -d dist`，并确认 `http://127.0.0.1:4173` 可访问。

- [ ] **Step 2: 导入现有存档并进入真实游戏界面**

优先通过 UI 导入 `.tmp-release-assets/WuXia_Save_Data.zip`；若入口受阻，按项目说明写入 IndexedDB `WuxiaGameDB/saves`。

- [ ] **Step 3: 注入脏地图层级并重新加载**

将一个 `null` 与合法节点共同写入存档的 `世界.地图层级`，重新加载该存档，确认应用没有启动或读档异常。

- [ ] **Step 4: 触发原始提示词构建路径**

在真实游戏界面发起一回合或调用应用实际提示词构建入口，确认不再出现 `Cannot read properties of null (reading '层级')`，并检查运行日志无同类错误。

- [ ] **Step 5: 检查移动端与日间主题**

在 `390x844` 和 day 主题下确认游戏界面正常显示；本修复无新增 UI，但需确认读档和回合入口可用。

### Task 5: 修复提交与发布元数据

**Files:**
- Modify: `release.config.json`
- Generated/Modify: `package.json`
- Generated/Modify: `package-lock.json`
- Generated/Modify: `data/releaseInfo.ts`
- Generated/Modify: `public/release-info.json`
- Modify: customer-facing changelog files produced by `release:sync`

- [ ] **Step 1: 提交已验证的根因修复**

只暂存源码、测试、设计和实施计划，不包含 `.reasonix/`、截图、日志、构建目录或测试产物。

- [ ] **Step 2: 将版本升级为 v1.0.622**

Run: `npm run release:bump -- 1.0.622`

Expected: `versionName=1.0.622`、`versionCode=622`，发布元数据同步完成。

- [ ] **Step 3: 写入客户更新说明**

说明旧存档或异常地图数据不再导致剧情无法继续，并包含 `https://msjh.bacon159.pp.ua/`；不包含内部管理内容。

- [ ] **Step 4: 刷新最终发布时间并再次同步**

在正式构建/上传前将 `releasePublishedAt` 写为 Asia/Shanghai 当前时间，然后运行 `npm run release:sync`。

- [ ] **Step 5: 创建并推送 main 发布备份提交**

Run: `git push origin main`

Expected: `main` 的 v1.0.622 发布提交成功推送到 `ypq123456789/MoRanJiangHu`。

### Task 6: APK 与网站正式构建

**Files:**
- Generated: `dist/**`
- Generated: `android/app/build/outputs/apk/release/app-release.apk`

- [ ] **Step 1: 同步并构建 APK**

Run: `npm run apk:release`

Expected: Gradle `assembleRelease` 成功，APK 存在且时间戳为本次构建。

- [ ] **Step 2: 验证本地 APK 签名**

使用 Android SDK `apksigner verify --verbose --print-certs`，确认签名有效、签名方案已记录，证书 SHA-256 为 `0c638692591300750ccc17cb828b5223bb9a5ef333095714377a6cd5adcbe48c`。

- [ ] **Step 3: 构建网站并记录静态哈希**

Run: `npm run build`

Expected: `dist/release-info.json` 为 v1.0.622；记录 `dist/index.html` 引用的 `assets/index-*.js`。

### Task 7: 上传、部署与在线验证

**Files:**
- Publish: OneDrive/OpenList APK
- Publish: GitHub Release APK
- Publish: Cloudflare update manifest
- Deploy: Cloudflare Worker/static assets

- [ ] **Step 1: 使用显式超时上传 APK**

分别执行 OneDrive/OpenList 与 GitHub Release 上传，避免使用可能无限等待的组合包装命令；逐项确认远端文件存在。

- [ ] **Step 2: 发布更新清单**

Run: `npm run release:manifest`

Expected: `/api/apk/latest.json` 返回 v1.0.622，并包含有效下载地址。

- [ ] **Step 3: 部署网站静态资源**

清除代理变量后运行构建与 `wrangler deploy`；确认输出明确报告上传静态文件，而非只更新 Worker/KV。

- [ ] **Step 4: 验证双域名静态资源**

对主站 `https://msjh.bacon159.pp.ua/` 和备用站 `https://msjh.bacon.de5.net/`：验证 `/release-info.json` 的版本、版本码、发布时间；验证 `index.html` 引用的哈希与本地 `dist` 完全一致；验证页面显示 v1.0.622 和正确发布时间。

- [ ] **Step 5: 验证全部公开入口**

使用显式超时检查网站 URL、APK 下载 URL、更新清单 URL、教程、同步指南、更新日志及文档记录的备用域名。

- [ ] **Step 6: 下载并复验公开 APK**

从公开下载 URL 下载 APK，运行 `apksigner verify --verbose --print-certs`，确认签名和证书指纹与本地 APK 一致，并对比文件散列。

- [ ] **Step 7: 检查 GitHub Actions CI**

显式查询 `ypq123456789/MoRanJiangHu` 中发布提交对应的最新 `CI`。若失败，读取日志、修复并重新推送；未成功不得报告发布完成。

### Task 8: 最终状态核验与交付

**Files:**
- Verify: git working tree
- Verify: release endpoints

- [ ] **Step 1: 重新运行关键测试与版本检查**

Run: `npm run test:run -- __tests__/mapLayerNullHardening.test.ts __tests__/mapE2E.test.ts __tests__/mapUpdateWorkflow.test.ts __tests__/worldbookSystemPrompt.test.ts`

Expected: 0 failures；本地与线上版本均为 v1.0.622。

- [ ] **Step 2: 检查仓库状态**

确认没有遗漏需备份的源码或发布元数据；`.reasonix/` 保持未跟踪且未提交。

- [ ] **Step 3: 输出工程摘要和客户更新说明**

报告版本从 1.0.621 升至 1.0.622、实际部署时间、测试/构建/APK 验签/双域名静态哈希/清单/下载/CI 证据，并提供可直接转发的中文客户更新说明及主站域名。
