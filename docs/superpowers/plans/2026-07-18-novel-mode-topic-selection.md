# 小说模式包题材选择实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为小说分解生成模式包增加可人工纠正的题材选择，并让该选择统一影响 AI 补全、本地生成和社区贡献。

**Architecture:** 保留现有关键词自动推断作为默认建议，新增导出的推断函数供界面初始化；界面状态保存当前选择，显式选择始终覆盖自动推断。题材切换时清除按旧题材生成的 AI 补全草稿，避免跨题材污染，不修改小说数据集和旧模式包结构。

**Tech Stack:** React 19、TypeScript、Vitest、Vite、Playwright、Capacitor Android。

---

### Task 1: 服务层显式题材优先级

**Files:**
- Modify: `services/novelDecompositionWorkshopBridge.ts`
- Test: `__tests__/novelDecompositionWorkshopBridge.test.ts`

- [ ] 写失败测试，证明含无限流关键词的数据集在显式指定 `武侠` 时仍生成武侠运行配置，且 AI 补全清理也使用显式题材。
- [ ] 运行 `npm run test:run -- __tests__/novelDecompositionWorkshopBridge.test.ts`，确认测试因 AI 补全接口不接受 `baseMode` 或推断函数不可访问而失败。
- [ ] 导出题材推断函数，并为 `AI补全小说模式包配置` 增加可选 `baseMode`，内部统一使用 `params.baseMode || 推断结果`。
- [ ] 重跑目标测试并确认通过。

### Task 2: 小说分解界面题材选择

**Files:**
- Modify: `components/features/Settings/NovelDecompositionSettings.tsx`
- Test: `__tests__/novelDecompositionTopicSelection.test.tsx`

- [ ] 写失败测试，验证题材选择器包含全部官方题材，并且显式选择会传给 AI 补全、本地生成和贡献模式包。
- [ ] 运行目标测试确认失败。
- [ ] 增加当前题材状态；切换数据集时自动推断并初始化，切换题材时清理旧 AI 补全草稿。
- [ ] 在两个小说分解操作区渲染同一题材下拉框，并给白天模式提供稳定可读的前景、背景和边框样式。
- [ ] 将当前题材传入三个模式包入口，重跑目标测试确认通过。

### Task 3: 回归、端到端与发布

**Files:**
- Modify: `release.config.json`
- Modify: `package.json`
- Modify: customer-facing changelog files selected by `release:sync`

- [ ] 运行小说分解相关测试及完整 `npm run test:run`。
- [ ] 运行 `npm run build`，启动本地预览，用 Playwright 在深色和白天模式验证题材选择、切换清理和生成入口。
- [ ] 将版本从 1.0.619 升级到 1.0.620，写入客户更新说明并同步发布元数据。
- [ ] 在最终发布前刷新 `releasePublishedAt`，再次运行 `npm run release:sync`，构建网站和 APK。
- [ ] 用 `apksigner` 验证本地 APK 签名及证书 SHA-256。
- [ ] 提交并推送发布备份提交，上传 APK、发布更新清单和 GitHub Release，部署 Cloudflare 网站。
- [ ] 分别验证主备域名的 `/release-info.json`、`index.html` 哈希、页面版本时间、APK 下载和更新清单。
- [ ] 下载线上 APK，重新验证签名与证书。
- [ ] 检查 `ypq123456789/MoRanJiangHu` 推送提交对应的最新 CI。
- [ ] 确认 PR #51 patch 已存在于 `main`，留言说明 cherry-pick 合入版本并关闭 PR。
