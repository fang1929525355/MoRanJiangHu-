# Novel Decomposition Failure Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让小说分解对单段格式错误自动局部重试，失败后继续执行剩余分段，并在最终统一汇总错误。

**Architecture:** 保留现有逐段解析和状态模型，在运行时增加最小重试下限，并把“首个失败阻塞”改为“跳过失败、寻找下一待处理项”。批次内失败只写回当前分段，不终止循环；最终根据待处理项和失败项分别返回进度、完成或失败汇总。

**Tech Stack:** TypeScript、Vitest、现有小说分解调度与存储服务。

---

### Task 1: 回归测试

**Files:**
- Create: `__tests__/novelDecompositionFailureContinuation.test.ts`
- Modify: `services/novelDecompositionRuntime.ts`

- [ ] **Step 1: 写失败测试**

构造两个待处理分段，解析器让首段持续抛出“缺少信息可见性标注”，第二段返回成功。断言默认配置仍重试首段，并且第二段最终完成。

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm run test:run -- __tests__/novelDecompositionFailureContinuation.test.ts`

Expected: FAIL，当前运行时在首段失败后停止或未提供最低重试次数。

- [ ] **Step 3: 最小实现**

在 `services/novelDecompositionRuntime.ts` 中：

```ts
const 自动重试次数 = Math.max(3, Number(task?.自动重试次数) || 0);
```

将首个未完成分段选择改为跳过 `失败` 状态；单段失败后继续当前批次；最终无待处理项且存在失败项时返回汇总错误。

- [ ] **Step 4: 运行聚焦测试确认 GREEN**

Run: `npm run test:run -- __tests__/novelDecompositionFailureContinuation.test.ts __tests__/novelDecompositionPipeline.test.ts`

Expected: PASS。

### Task 2: 完整验证

**Files:**
- Test: `__tests__/novelDecompositionFailureContinuation.test.ts`
- Test: `__tests__/novelDecompositionPipeline.test.ts`

- [ ] **Step 1: 运行小说分解相关测试**

Run: `npm run test:run -- __tests__/novelDecomposition*.test.ts __tests__/novelDecomposition*.test.tsx`

Expected: PASS。

- [ ] **Step 2: 运行生产构建**

Run: `npm run build`

Expected: exit code 0。

- [ ] **Step 3: 检查差异**

Run: `git diff --check`

Expected: 无空白错误，不包含发布元数据或生成产物。

