# Mode Package Narrative Overrides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让完整模式包可编辑主线方向、暗线策略和世界推进规则，并让官方模板真正携带官方题材内容，同时保持旧模式包无损兼容。

**Architecture:** 新字段保存在完整模式包 payload 中，由贡献草稿往返转换统一管理；构建模式包时把非空字段转换为职责隔离的模式世界书条目，通过现有世界书作用域进入正文、开局、规划和世界演变链路。官方模板从现有题材配置表生成真实正文和安全的默认叙事策略，不复制底层系统协议。

**Tech Stack:** React 19、TypeScript、Vitest、Vite、Playwright、Cloudflare Workers/Assets、Capacitor Android。

---

### Task 1: 建立新增字段与兼容性回归测试

**Files:**
- Modify: `__tests__/workshopDraftRoundTrip.test.ts`
- Modify: `components/features/Workshop/CreativeWorkshopModal.tsx`

- [ ] 在 `workshopDraftRoundTrip.test.ts` 添加失败测试：三个字段从草稿构建到模块，再还原草稿后保持一致。
- [ ] 添加失败测试：旧模式包没有新字段时，构建结果不生成叙事覆盖世界书条目。
- [ ] 添加失败测试：未知 payload 和运行时扩展字段在新增字段往返后仍保留。
- [ ] 运行 `npm run test:run -- __tests__/workshopDraftRoundTrip.test.ts`，确认因字段缺失失败。
- [ ] 在贡献草稿、空草稿、模块解析和模块构建 payload 中加入三个可选文本字段。
- [ ] 重新运行测试并确认通过。

### Task 2: 生成职责隔离的叙事覆盖世界书

**Files:**
- Modify: `__tests__/workshopDraftRoundTrip.test.ts`
- Modify: `components/features/Workshop/CreativeWorkshopModal.tsx`

- [ ] 添加失败测试：非空主线方向生成 `narrative-main-story` 条目，作用域为 `main/opening/story_plan/heroine_plan`。
- [ ] 添加失败测试：非空暗线策略生成 `narrative-hidden-plot` 条目，作用域包含 `world_evolution`。
- [ ] 添加失败测试：非空世界推进规则生成 `narrative-world-evolution` 条目，作用域为 `main/world_evolution/story_plan`。
- [ ] 添加失败测试：条目正文声明不得覆盖变量协议、命令格式、数据结构、安全和一致性规则。
- [ ] 运行目标测试确认失败。
- [ ] 在模式世界书构建器中按非空字段追加三个条目，并使用稳定 ID、明确标题和限定作用域。
- [ ] 运行目标测试确认通过。

### Task 3: 让官方模板携带真实官方内容

**Files:**
- Modify: `__tests__/workshopDraftRoundTrip.test.ts`
- Modify: `components/features/Workshop/CreativeWorkshopModal.tsx`
- Modify: `data/workshopThemes/topicModeThemeData.ts`（仅在需要导出辅助函数时）

- [ ] 添加失败测试：现代都市官方模板的题材正文来自 `promptLines`，世界规则来自 `worldDefaults.worldExtraRequirement`，能力正文来自 `manualRealmPrompt`。
- [ ] 添加失败测试：官方模板不包含“模板：在此填写”占位文本，并带有现代都市默认叙事策略。
- [ ] 导出或复用官方模板草稿构建器，使测试直接验证真实构建结果。
- [ ] 为八种官方题材生成中性的主线、暗线和世界推进默认策略，其中现代都市保持现实、可低压、不过度阴谋化。
- [ ] 运行目标测试确认通过。

### Task 4: 添加创意工坊编辑界面

**Files:**
- Modify: `components/features/Workshop/CreativeWorkshopModal.tsx`
- Modify: `__tests__/workshopDraftRoundTrip.test.ts` 或新增轻量组件测试

- [ ] 添加失败测试或静态断言，确认完整模式包表单包含三个字段标签，普通模块不写入这些字段。
- [ ] 在完整模式包表单加入“叙事方向控制”区域、说明文字和三个受控文本框。
- [ ] 使用主题兼容的边框、背景和文本颜色，避免黑色加载/占位面板。
- [ ] 运行目标测试与 TypeScript/Vite 构建。

### Task 5: 验证最终提示词注入链路

**Files:**
- Modify: `__tests__/worldbook.test.ts`、`__tests__/modeRuntimePassthrough.test.ts` 或最接近现有注入测试的文件
- Modify: 必要的世界书注入代码（仅在测试证明链路缺失时）

- [ ] 构造“轻松愉快现代都市”模式世界书并验证 `main`、`opening`、`story_plan`、`world_evolution` 各自取到职责匹配的覆盖文本。
- [ ] 验证未匹配作用域不会误注入其他叙事字段。
- [ ] 如现有世界书作用域已正确工作，不修改生产注入代码；否则用最小改动修复。
- [ ] 运行相关测试和完整 `npm run test:run`。

### Task 6: 浏览器端到端与主题验证

**Files:**
- No production file required unless E2E reveals a defect

- [ ] 运行 `npm run build`。
- [ ] 后台启动本地静态预览并确认 HTTP 可访问。
- [ ] 在桌面视口打开创意工坊，载入现代都市官方模板。
- [ ] 验证真实官方三段正文和三个叙事字段可见。
- [ ] 修改为轻松日常内容，保存本地包，重新载入并确认无损。
- [ ] 在白天主题检查文字、输入框和说明可读。
- [ ] 在移动视口检查表单无横向溢出且字段可编辑。
- [ ] 保留测试证据，但不把截图、trace 或测试产物加入 git。

### Task 7: 发布新版本

**Files:**
- Modify: `release.config.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `data/releaseInfo.ts`
- Modify: 其他由 `npm run release:sync` 正常更新的发布元数据或客户文档

- [ ] 确认功能测试、完整测试和本地构建通过。
- [ ] 使用发布脚本将版本从 `1.0.618` 升级到下一版本，并同步发布元数据。
- [ ] 写入客户可见中文更新说明，只描述玩家可见的模式包编辑能力。
- [ ] 在最终构建前把 `releasePublishedAt` 刷新为当前本地时间，再运行 `npm run release:sync`。
- [ ] 构建网站和 APK，使用 `apksigner` 验证签名与证书 SHA-256。
- [ ] 创建包含功能、测试、发布元数据和客户说明的发布备份提交。
- [ ] 上传 OneDrive/OpenList 和 GitHub Release 渠道，使用显式超时逐项验证 APK。
- [ ] 清除代理变量后部署 Cloudflare，并确认输出实际上传静态资源。
- [ ] 在主备域名验证 `release-info.json`、`index.html` 哈希、版本和发布时间。
- [ ] 验证 `/api/apk/latest.json`、APK 下载 URL、更新清单及文档化备份入口。
- [ ] 推送发布提交到 `origin` 对应发布分支/主分支，并检查 `ypq123456789/MoRanJiangHu` 最新 CI 对应提交成功。
