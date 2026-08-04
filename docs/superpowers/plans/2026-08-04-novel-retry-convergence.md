# 小说分解补漏收敛修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让小说分解自动恢复内嵌的信息可见性字段和明确的跨午夜日期遗漏，使重复失败分段在下一次补漏中收敛完成。

**Architecture:** 在 `novelDecompositionPipeline` 的 AI 结果规范化阶段加入两个纯函数：一个恢复可见信息条目文本中的结构化可见性，另一个依据前序时间修复明确的夜间到凌晨跨日。规范化仍位于严格校验之前，无法可靠修复的数据继续沿用现有错误与定向重试。

**Tech Stack:** TypeScript、Vitest、Vite、现有小说分解时间工具。

---

## Task 1: 恢复内嵌的信息可见性

**Files:**
- Modify: `services/novelDecompositionPipeline.ts`
- Test: `__tests__/novelDecompositionPipeline.test.ts`

- [ ] **Step 1: 写入失败回归测试**

在 `__tests__/novelDecompositionPipeline.test.ts` 增加两个测试。第一个让 `hardConstraints[0].内容` 使用线上真实形态：

```ts
内容: '李辅国夺舍新君必须在子时进行 / 谁知道：李辅国、读者 / 谁不知道：程宗扬、杨玉环 / 是否仅读者视角可见：否',
信息可见性: { 谁知道: [], 谁不知道: [], 是否仅读者视角可见: false }
```

断言 `解析小说拆分分段` 成功，并得到：

```ts
expect(segment.原著硬约束[0]).toEqual({
    内容: '李辅国夺舍新君必须在子时进行',
    信息可见性: {
        谁知道: ['李辅国', '读者'],
        谁不知道: ['程宗扬', '杨玉环'],
        是否仅读者视角可见: false
    }
});
```

第二个测试同时提供正式结构化值和文本尾注，断言正式值优先合并、不会被空值覆盖，且 `内容` 不再包含尾注。

- [ ] **Step 2: 运行测试确认 RED**

Run:

```powershell
npm run test:run -- __tests__/novelDecompositionPipeline.test.ts
```

Expected: 新测试失败，错误为“缺少信息可见性标注”或内容仍包含尾随字段。

- [ ] **Step 3: 实现最小可见性恢复函数**

在 `services/novelDecompositionPipeline.ts` 中新增：

```ts
const 从内容恢复信息可见性 = (value: unknown) => {
    // 返回清理后的内容和解析出的信息可见性；无法识别时返回空恢复值。
};
```

实现要求：

- 识别 `谁知道`、`谁不知道`、`是否仅读者视角可见` 三个标签。
- 支持 `：`、`:`，并以 `/`、换行或右括号作为字段边界。
- 人名列表使用 `、`、`，`、`,`、`；` 分隔并去重。
- “是/true”解析为 `true`，“否/false”解析为 `false`。
- 修改 `规范化可见信息条目`，将恢复结果与 `value.信息可见性` 合并；正式非空数组优先，恢复值补空字段。
- 成功识别后从 `内容` 中删除尾注并清理多余括号、斜线和空白。

- [ ] **Step 4: 运行测试确认 GREEN**

Run:

```powershell
npm run test:run -- __tests__/novelDecompositionPipeline.test.ts
```

Expected: 新增可见性测试通过，现有测试无回归。

- [ ] **Step 5: 提交可见性修复**

```powershell
git add services/novelDecompositionPipeline.ts __tests__/novelDecompositionPipeline.test.ts
git commit -m "fix: 恢复小说分解内嵌信息可见性"
```

## Task 2: 修复明确的跨午夜日期遗漏

**Files:**
- Modify: `services/novelDecompositionPipeline.ts`
- Test: `__tests__/novelDecompositionPipeline.test.ts`

- [ ] **Step 1: 写入失败回归测试**

增加三个测试：

1. 分段起点为 `0003:02:28:23:59`，AI 返回终点 `0003:02:28:04:00`，断言终点恢复为 `0003:02:29:04:00`。
2. 关键事件在 `23:59` 后返回同日 `01:00` 到 `04:00`，断言开始、窗口和结束时间都进入次日并保持单调。
3. 起点 `12:00`、终点 `04:00` 不属于明确夜间跨日，断言仍抛出“结束时间早于起始时间”。

所有测试通过模拟 `generateNovelDecomposition` 调用真实 `解析小说拆分分段`，不直接测试私有辅助函数。

- [ ] **Step 2: 运行测试确认 RED**

Run:

```powershell
npm run test:run -- __tests__/novelDecompositionPipeline.test.ts
```

Expected: 前两个测试因日期未推进而失败，第三个测试保持现有失败行为。

- [ ] **Step 3: 实现最小跨午夜修复**

扩展时间工具导入：

```ts
import {
    增加小说时间线天数,
    默认小说时间线起点,
    尝试规范化小说时间锚点,
    规范化小说时间锚点,
    小说时间锚点转分钟序数
} from './novelDecompositionTime';
```

新增纯函数：

```ts
const 修复明确跨午夜时间 = (candidate: string, reference?: string): string => {
    // 仅同年月日、reference 小时 >= 18、candidate 小时 <= 12 且 candidate 早于 reference 时增加一天。
};
```

将其应用到：

- `时间线终点`，参考 `时间线起点`。
- 每个关键事件的 `开始时间 -> 最早开始时间 -> 最迟开始时间 -> 结束时间` 链。
- 使用 `增加小说时间线天数` 处理月末、年末，不直接拼接日期。

- [ ] **Step 4: 运行测试确认 GREEN**

Run:

```powershell
npm run test:run -- __tests__/novelDecompositionPipeline.test.ts
```

Expected: 跨午夜测试通过，普通倒序仍按预期被拒绝。

- [ ] **Step 5: 提交时间修复**

```powershell
git add services/novelDecompositionPipeline.ts __tests__/novelDecompositionPipeline.test.ts
git commit -m "fix: 修复小说分解跨午夜时间"
```

## Task 3: 验证补漏链路与生产构建

**Files:**
- Verify: `services/novelDecompositionRuntime.ts`
- Verify: `services/novelDecompositionPipeline.ts`
- Verify: `__tests__/novelDecompositionPipeline.test.ts`
- Verify: `__tests__/novelDecompositionSchedulerBackoff.test.ts`

- [ ] **Step 1: 运行小说分解相关测试**

```powershell
npm run test:run -- __tests__/novelDecompositionPipeline.test.ts __tests__/novelDecompositionSchedulerBackoff.test.ts __tests__/novelDecompositionEpubRepairWorkflow.test.ts
```

Expected: 全部通过。

- [ ] **Step 2: 运行全量测试**

```powershell
$env:MORAN_E2E_AI_BASE_URL=$null
$env:MORAN_E2E_AI_API_KEY=$null
$env:MORAN_E2E_AI_MODEL=$null
npm run test:run
```

Expected: 所有本地测试通过，真实外部 AI E2E 按环境缺失跳过。

- [ ] **Step 3: 运行生产构建**

```powershell
npm run build
```

Expected: Vite 构建退出码 0；只允许现有纹理解析和循环 chunk 警告。

- [ ] **Step 4: 检查变更范围**

```powershell
git diff --check
git status --short
git log -5 --oneline
```

Expected: 只有设计、计划、实现和测试文件；无构建产物、日志或临时文件。

- [ ] **Step 5: 提交最终验证记录所需的小调整（仅在必要时）**

若格式化或测试暴露了仅属于本功能的必要修正，完成后重新运行步骤 1-4，并使用：

```powershell
git add services/novelDecompositionPipeline.ts __tests__/novelDecompositionPipeline.test.ts
git commit -m "test: 完善小说分解补漏收敛验证"
```
