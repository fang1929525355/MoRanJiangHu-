# WorkBuddy Feedback v1.0.634 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复玩家反馈的流式输出中断、酒馆预设切换后严格旁白/对白格式不再生效，以及旧页面动态模块失效导致整个应用被根错误边界接管的问题，并发布包含真实 APK 更新的 v1.0.634。

**Architecture:** 请求层在 SSE 正常结束、提前关闭和 `content_filter` 之间建立明确的结束信号，主剧情重试层仅对意外终止改用非流式。酒馆组包层把“严格旁白/对白格式”视为玩家显式硬约束，在外部预设没有注入项目格式时补一条最终格式消息。设置弹窗使用局部错误边界承接旧 chunk 加载失败，保留主游戏界面并提供关闭或刷新入口。

**Tech Stack:** React 19、TypeScript、Vite、Vitest、Capacitor Android、Cloudflare Workers、GitHub Actions。

---

### Task 1: 接续并验证流式意外终止降级

**Files:**
- Modify: `services/ai/chatCompletionClient.ts`
- Modify: `services/ai/storyTasks.ts`
- Modify: `hooks/useGame/sendWorkflow.ts`
- Test: `__tests__/streamPrematureEndFallback.test.ts`

- [ ] **Step 1: 将 WorkBuddy 中未提交的三个源码文件和回归测试复制到隔离工作树**

保留现有 `onStreamEnd({ sawDone, finishReason, accumulatedLength })`、`流式意外终止` 标记与外层非流式降级逻辑，不重写玩家已有改动。

- [ ] **Step 2: 运行现有回归测试**

Run: `npm test -- --run __tests__/streamPrematureEndFallback.test.ts`

Expected: 7 tests PASS；无 `[DONE]` 且截断的响应被标记，完整响应即使供应商省略 `[DONE]` 仍可接受。

- [ ] **Step 3: 增加真实重试模式断言**

在测试中记录 `generateStoryResponse` 两次调用的 `streamOptions`：第一次为 `{ stream: true }`，第一次抛出带 `流式意外终止` 标记的错误后，第二次必须为 `undefined`。

- [ ] **Step 4: 运行新增测试并确认能约束降级行为**

Run: `npm test -- --run __tests__/streamPrematureEndFallback.test.ts`

Expected: PASS，且第二次请求明确为非流式。

### Task 2: 恢复酒馆预设下的严格旁白/对白格式

**Files:**
- Modify: `hooks/useGame/mainStoryRequest.ts`
- Modify: `__tests__/storyLengthValidation.test.ts`
- Modify: `__tests__/tavernPresetTakeover.test.ts`

- [ ] **Step 1: 写失败测试**

在酒馆预设不含 `{{格式}}`/`{{format}}` 占位符时：

```ts
expect(result.messageEntries).toContainEqual(expect.objectContaining({
  id: 'tavern_format_requirement',
  role: 'system',
  content: expect.stringContaining('【旁白】')
}));
```

并验证 `启用严格正文对白格式: false` 时仍保持外部预设完全接管，不注入该消息；预设已使用格式占位符时不重复注入。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm test -- --run __tests__/storyLengthValidation.test.ts __tests__/tavernPresetTakeover.test.ts`

Expected: FAIL，缺少 `tavern_format_requirement`。

- [ ] **Step 3: 写最小实现**

在 `构建主剧情请求参数` 的酒馆分支完成预设消息组包后执行：

```ts
const strictFormatPrompt = runtimeGameConfig.启用严格正文对白格式 !== false
  ? params.builtContext.contextPieces.格式提示词.trim()
  : '';
const formatAlreadyInjected = strictFormatPrompt
  && tavernMessages.some((message) => message.content.includes(strictFormatPrompt));
if (strictFormatPrompt && !formatAlreadyInjected) {
  messageEntries.push({
    id: 'tavern_format_requirement',
    title: '酒馆严格旁白/对白格式',
    category: '系统',
    role: 'system',
    content: strictFormatPrompt
  });
}
```

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `npm test -- --run __tests__/storyLengthValidation.test.ts __tests__/tavernPresetTakeover.test.ts`

Expected: PASS；严格开关开启时补格式，关闭时不补，已有占位符时不重复。

### Task 3: 防止 settings-world 旧 chunk 错误击穿根界面

**Files:**
- Modify: `App.tsx`
- Test: `__tests__/settingsLazyImportBoundary.test.ts`

- [ ] **Step 1: 写失败的结构回归测试**

读取 `App.tsx` 的设置弹窗区块，断言其结构为：

```tsx
<ModalErrorBoundary title="设置打开失败" onClose={closeSettings}>
  <懒加载边界>...</懒加载边界>
</ModalErrorBoundary>
```

并断言 `SettingsModal` 与 `MobileSettingsModal` 均位于该局部边界内。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm test -- --run __tests__/settingsLazyImportBoundary.test.ts`

Expected: FAIL，当前设置弹窗只有 `Suspense`，错误会冒泡到根 `ErrorBoundary`。

- [ ] **Step 3: 写最小实现**

在 `state.showSettings` 区块内，用现有 `ModalErrorBoundary` 包住设置懒加载树并传入 `onClose={closeSettings}`，保留现有 `DynamicImportDeferredReloadError` 的“刷新重试”按钮。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `npm test -- --run __tests__/settingsLazyImportBoundary.test.ts __tests__/lazyImportWithReload.test.ts`

Expected: PASS；旧 chunk 错误只关闭/刷新设置弹窗，不再让整个游戏进入根错误页。

### Task 4: 完整验证与本地 UI 检查

**Files:**
- Verify: changed source and tests

- [ ] **Step 1: 运行针对性回归**

Run: `npm test -- --run __tests__/streamPrematureEndFallback.test.ts __tests__/storyLengthValidation.test.ts __tests__/tavernPresetTakeover.test.ts __tests__/settingsLazyImportBoundary.test.ts __tests__/lazyImportWithReload.test.ts __tests__/storyResponseParser.test.ts`

- [ ] **Step 2: 运行全量测试**

Run: `npm test -- --run`

Expected: 所有本地确定性测试通过；若仅外部 AI E2E 因网络/凭据失败，记录精确用例和证据。

- [ ] **Step 3: 构建网页**

Run: `npm run build`

Expected: exit 0，并记录 `dist/index.html` 引用的 `assets/index-*.js`。

- [ ] **Step 4: 本地浏览器验证**

使用现有存档进入真实游戏，在 `day` 主题打开设置：切换酒馆预设与“严格旁白/对白格式”开关，确认状态可恢复、文字可读；同时确认设置弹窗能关闭且不遮挡主界面。

### Task 5: PR、CodeRabbit 与 CI

**Files:**
- Commit all source/test/plan files for the fix branch

- [ ] **Step 1: 提交并推送 `codex/workbuddy-feedback-v634`**

Run: `git add <scoped files> && git commit -m "fix: 修复流式中断与设置回归" && git push -u origin codex/workbuddy-feedback-v634`

- [ ] **Step 2: 创建 PR 到 `main`**

PR 描述列出三项修复、测试命令和发布计划。

- [ ] **Step 3: 等待并处理 CodeRabbit 审查**

逐条核实评论；合理意见先补失败测试再修改；回复并确认评论闭环。

- [ ] **Step 4: 确认 PR CI 成功并合并**

合并后在主仓库 `main` 拉取最新提交并重新跑针对性测试与构建。

### Task 6: 发布 v1.0.634（含 APK）

**Files:**
- Modify: `release.config.json`
- Modify via sync: `package.json`, `android/app/build.gradle`, `data/releaseInfo.ts`, `public/release-info.json`
- Build: `android/app/build/outputs/apk/release/app-release.apk`

- [ ] **Step 1: 在 `main` 将版本从 1.0.633/633 升到 1.0.634/634**

发布说明只包含玩家可见内容：流式中断自动恢复、严格旁白/对白格式恢复、设置模块更新后不再击穿整个界面。

- [ ] **Step 2: 刷新真实发布时间并运行 `npm run release:sync`**

`releasePublishedAt` 使用发布前当前北京时间，再执行同步。

- [ ] **Step 3: 创建并推送发布备份提交**

提交必须在 `main`，并在构建、上传、部署前推送到 `origin/main`。

- [ ] **Step 4: 构建网页与 APK**

Run: `npm run build`, `npm run apk:sync`, `cd android; .\\gradlew.bat assembleRelease`

- [ ] **Step 5: 验证 APK**

使用 `apksigner verify --verbose --print-certs`，确认版本 634、签名方案有效、证书 SHA-256 为 `0c638692591300750ccc17cb828b5223bb9a5ef333095714377a6cd5adcbe48c`，并记录 APK 大小与 SHA-256。

- [ ] **Step 6: 上传并发布**

分别执行 GitHub Release、OneDrive/OpenList APK 上传、Cloudflare 网站部署与远程 KV manifest 写入；所有外部命令使用显式超时。

- [ ] **Step 7: 全发布面验证**

双域 `/release-info.json` 必须为 1.0.634/634 且时间一致；双域 `index.html` 的 hashed bundle 与本地 `dist` 一致；`/api/apk/latest.json` 的版本、大小、SHA 与 APK 一致；下载公开 APK 后再次验证大小、SHA、版本和签名。

- [ ] **Step 8: 检查目标仓库 CI**

明确检查 `ypq123456789/MoRanJiangHu` 上发布提交对应的最新 `CI` run；失败则读取日志并修复或报告阻塞。
