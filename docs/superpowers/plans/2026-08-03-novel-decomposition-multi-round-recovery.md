# 小说分解多轮补漏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 小说分解遍历全部分段后自动按轮次重跑普通失败项，直到全部成功；仅明确渠道永久故障停止。

**Architecture:** 在运行时增加渠道故障分类、补漏轮次计算和失败项重新排队。分段解析入口接收上一次校验错误并生成定向纠错提示，使后续轮次不是盲目重复同一请求。现有任务状态继续复用，轮次保存在任务扩展字段中，兼容旧存档。

**Tech Stack:** TypeScript、Vitest、IndexedDB 数据存储、现有小说分解后台调度器。

---

### Task 1: 错误分类与纠错提示

**Files:**
- Modify: `services/novelDecompositionRuntime.ts`
- Modify: `services/novelDecompositionPipeline.ts`
- Test: `__tests__/novelDecompositionFailureContinuation.test.ts`

- [ ] **Step 1: 写失败测试**

增加断言：401、403、404、无效模型、余额不足返回渠道故障；429、timeout、503、信息可见性缺失返回普通错误。增加断言：已有 `最近错误` 的失败段再次解析时，请求参数包含该错误以及结构化纠错要求。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm run test:run -- __tests__/novelDecompositionFailureContinuation.test.ts`

Expected: FAIL，缺少渠道错误分类函数和重试纠错提示。

- [ ] **Step 3: 实现最小错误分类**

在运行时导出 `判断小说拆分渠道永久故障(error)`。优先读取 `status`/`statusCode`，再匹配错误文本；只将 401、403、404、无效模型/API 地址、余额与永久配额错误判为永久故障。

- [ ] **Step 4: 实现局部纠错提示**

为 `解析小说拆分分段` 增加可选参数 `retryCorrection?: string`。生成请求时追加完整重输出要求，并针对信息可见性和时间线错误加入精确字段提示。

- [ ] **Step 5: 运行测试确认 GREEN**

Run: `npm run test:run -- __tests__/novelDecompositionFailureContinuation.test.ts __tests__/novelDecompositionPipeline.test.ts`

Expected: PASS。

### Task 2: 多轮失败项重新排队

**Files:**
- Modify: `services/novelDecompositionRuntime.ts`
- Modify: `services/novelDecompositionStore.ts`
- Test: `__tests__/novelDecompositionFailureContinuation.test.ts`

- [ ] **Step 1: 写第一轮失败、第二轮成功的执行链测试**

第一次调用执行器时让首段耗尽局部重试、第二段成功；断言结果为 `progress` 而非 `failed`，失败段重新成为 `待处理`，轮次变为 2。第二次调用只解析首段并成功，最终返回 `completed`。

- [ ] **Step 2: 写渠道故障停止测试**

让解析器抛出带 `status: 404` 的错误；断言执行器停止当前批次、任务进入 `failed`，失败段不会重新排队。

- [ ] **Step 3: 运行测试确认 RED**

Run: `npm run test:run -- __tests__/novelDecompositionFailureContinuation.test.ts`

Expected: FAIL，当前一轮结束后仍返回最终失败。

- [ ] **Step 4: 实现轮次切换**

一轮结束且不存在渠道永久故障时，将失败段保留 `最近错误` 并重置为 `待处理`，更新 `当前补漏轮次`，返回 `progress`。渠道故障记录为任务最近错误并返回 `failed`。

- [ ] **Step 5: 保持旧任务兼容**

任务规范化时将缺失的 `当前补漏轮次` 视为 1；非正数归一为 1。成功完成时保留最终轮次供进度展示。

- [ ] **Step 6: 运行测试确认 GREEN**

Run: `npm run test:run -- __tests__/novelDecompositionFailureContinuation.test.ts __tests__/novelDecompositionPipeline.test.ts __tests__/novelDecompositionApiDiagnostics.test.ts`

Expected: PASS。

### Task 3: 轮次进度与退避

**Files:**
- Modify: `services/novelDecompositionRuntime.ts`
- Test: `__tests__/novelDecompositionFailureContinuation.test.ts`

- [ ] **Step 1: 增加进度文案测试**

断言轮次切换消息包含“第 1 轮已完成”“第 2 轮补漏”“剩余 1 个失败分段”；下一轮分段开始消息包含当前轮次。

- [ ] **Step 2: 实现有上限退避**

轮次间使用 `min(30000, 2000 * 2^max(0, round-3))` 毫秒的非阻塞退避。测试环境通过导出的纯函数验证等待值，不执行真实长等待。

- [ ] **Step 3: 运行测试**

Run: `npm run test:run -- __tests__/novelDecompositionFailureContinuation.test.ts`

Expected: PASS。

### Task 4: 完整验证与提交

**Files:**
- Verify: all modified source, tests, spec and plan files

- [ ] **Step 1: 运行小说分解针对性测试**

Run: `npm run test:run -- __tests__/novelDecompositionFailureContinuation.test.ts __tests__/novelDecompositionPipeline.test.ts __tests__/novelDecompositionApiDiagnostics.test.ts __tests__/novelDecompositionApiSettings.test.tsx`

Expected: all PASS。

- [ ] **Step 2: 运行全量测试**

Run: `npm run test:run`

Expected: exit 0；若外部 AI 实网测试仅因网络波动失败，单独复跑并记录证据。

- [ ] **Step 3: 生产构建**

Run: `npm run build`

Expected: exit 0。

- [ ] **Step 4: 检查差异并提交**

Run: `git diff --check`

Expected: no whitespace errors。提交消息：`fix: 小说分解自动多轮补漏失败章节`。
