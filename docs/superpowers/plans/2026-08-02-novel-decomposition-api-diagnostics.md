# 小说分解接口测试与运行诊断 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为小说分解接口增加可验证当前表单配置的连接测试，并让关键运行进度和错误明确显示实际渠道与模型。

**Architecture:** 在 `utils/apiConfig.ts` 提供模型 ID 与接口身份的纯函数，让设置页和后台运行共用同一套配置解析及显示口径。设置页复用通用文本请求客户端执行非流式短请求；后台执行器只在关键日志和结果中追加接口身份，不修改流式正文。

**Tech Stack:** React 19、TypeScript、Vitest、Vite、Tailwind CSS。

---

## 文件结构

- 修改 `utils/apiConfig.ts`：提供 Gemini 模型资源前缀规范化及小说分解接口身份格式化，并在最终配置解析中防御性规范化模型名。
- 修改 `components/features/Settings/NovelDecompositionApiSettings.tsx`：规范化模型列表，增加当前表单连接测试和结果展示。
- 修改 `services/novelDecompositionRuntime.ts`：在关键进度、重试、失败和最终结果中附带接口身份。
- 新建 `__tests__/novelDecompositionApiDiagnostics.test.ts`：覆盖纯函数、配置解析与密钥不泄露。
- 修改 `__tests__/novelDecompositionWorkbenchLayout.test.tsx`：覆盖设置页测试按钮、结果身份和日间模式样式契约；若该文件不适合挂载设置组件，则新建 `__tests__/novelDecompositionApiSettings.test.tsx`。

### Task 1: 模型 ID 与接口身份纯函数

**Files:**
- Modify: `utils/apiConfig.ts`
- Create: `__tests__/novelDecompositionApiDiagnostics.test.ts`

- [ ] **Step 1: 编写失败测试**

测试应直接导入期望 API，验证以下行为：

```ts
import { describe, expect, it } from 'vitest';
import {
    规范化Gemini模型资源ID,
    格式化小说拆分接口身份,
    获取小说拆分接口配置
} from '../utils/apiConfig';

describe('小说分解接口诊断', () => {
    it('仅移除 Gemini 模型资源前缀', () => {
        expect(规范化Gemini模型资源ID('models/gemini-2.5-flash')).toBe('gemini-2.5-flash');
        expect(规范化Gemini模型资源ID('vendor/gemini-2.5-flash')).toBe('vendor/gemini-2.5-flash');
    });

    it('接口身份包含渠道与模型且不泄露密钥', () => {
        const text = 格式化小说拆分接口身份({
            id: 'novel',
            名称: '自建 Gemini2API',
            供应商: 'openai_compatible',
            baseUrl: 'https://example.test/v1',
            apiKey: 'secret-key',
            model: 'gemini-2.5-flash',
            maxTokens: 32768
        });
        expect(text).toBe('渠道：自建 Gemini2API｜模型：gemini-2.5-flash');
        expect(text).not.toContain('secret-key');
    });
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm run test:run -- __tests__/novelDecompositionApiDiagnostics.test.ts`

Expected: FAIL，提示两个新导出不存在。

- [ ] **Step 3: 实现最小纯函数及配置规范化**

在 `utils/apiConfig.ts` 增加：

```ts
export const 规范化Gemini模型资源ID = (value: unknown): string => (
    读取字符串(value).trim().replace(/^models\//i, '')
);

export const 格式化小说拆分接口身份 = (
    apiConfig: 当前可用接口结构 | null | undefined
): string => {
    const channel = 读取字符串(apiConfig?.名称).trim()
        || 读取字符串(apiConfig?.供应商).trim()
        || '小说拆分独立接口';
    const model = 读取字符串(apiConfig?.model).trim() || '未配置';
    return `渠道：${channel}｜模型：${model}`;
};
```

在 `获取小说拆分接口配置` 中仅对最终小说拆分模型调用 `规范化Gemini模型资源ID`，不全局改写其他功能模型。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `npm run test:run -- __tests__/novelDecompositionApiDiagnostics.test.ts`

Expected: PASS，0 failures。

- [ ] **Step 5: 提交本任务**

```powershell
git add -- utils/apiConfig.ts __tests__/novelDecompositionApiDiagnostics.test.ts
git commit -m "fix: 规范化小说分解模型诊断信息"
```

### Task 2: 设置页连接测试

**Files:**
- Modify: `components/features/Settings/NovelDecompositionApiSettings.tsx`
- Create: `__tests__/novelDecompositionApiSettings.test.tsx`

- [ ] **Step 1: 编写失败组件测试**

测试挂载 `NovelDecompositionApiSettings`，传入名为“自建 Gemini2API”、模型为 `models/gemini-2.5-flash` 的表单配置，并 mock `请求模型文本`。断言：

```ts
expect(screen.getByRole('button', { name: '测试连接' })).toBeTruthy();
fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
await waitFor(() => expect(screen.getByText(/渠道：自建 Gemini2API/)).toBeTruthy());
expect(screen.getByText(/模型：gemini-2.5-flash/)).toBeTruthy();
expect(screen.queryByText(/secret-key/)).toBeNull();
```

另写失败分支，使请求抛出 `404 Requested entity was not found`，断言结果同时包含渠道、模型和完整 404 信息。

- [ ] **Step 2: 运行组件测试确认 RED**

Run: `npm run test:run -- __tests__/novelDecompositionApiSettings.test.tsx`

Expected: FAIL，找不到“测试连接”按钮。

- [ ] **Step 3: 实现当前表单连接测试**

在组件内增加 `testingConnection` 和 `connectionResult` 状态；点击时先对当前 `form` 执行 `规范化接口设置` 与 `获取小说拆分接口配置`，然后调用：

```ts
await 请求模型文本(apiConfig, [
    { role: 'user', content: '你好，请只回复 OK。' }
], {
    temperature: 0,
    streamOptions: { stream: false },
    errorDetailLimit: Number.POSITIVE_INFINITY,
    disableThinking: true,
    stripReasoning: true
});
```

按钮文字依状态显示“测试连接”或“测试中...”。结果区域首行显示 `格式化小说拆分接口身份(apiConfig)`，第二部分显示耗时与回复或错误。按钮和结果区域使用已有 emerald/amber 语义色，并增加 `html[data-theme="day"]` 可读性类或项目现有 day-theme 稳定样式。

模型列表读取时对每个 `m.id` 调用 `规范化Gemini模型资源ID` 后去重。

- [ ] **Step 4: 运行组件测试确认 GREEN**

Run: `npm run test:run -- __tests__/novelDecompositionApiSettings.test.tsx`

Expected: PASS，成功和失败分支均通过。

- [ ] **Step 5: 提交本任务**

```powershell
git add -- components/features/Settings/NovelDecompositionApiSettings.tsx __tests__/novelDecompositionApiSettings.test.tsx
git commit -m "feat: 增加小说分解接口连接测试"
```

### Task 3: 后台进度与错误携带接口身份

**Files:**
- Modify: `services/novelDecompositionRuntime.ts`
- Modify: `__tests__/novelDecompositionPipeline.test.ts`

- [ ] **Step 1: 编写失败测试**

复用小说分解后台执行测试夹具，使解析请求抛出 404；订阅调度器日志并断言：

```ts
expect(logTexts.some((text) => (
    text.includes('渠道：自建 Gemini2API｜模型：gemini-2.5-flash')
    && text.includes('Requested entity was not found')
))).toBe(true);
```

再覆盖首条“开始处理分段”和重试日志，确保身份文本存在且 `secret-key` 不存在。

- [ ] **Step 2: 运行后台测试确认 RED**

Run: `npm run test:run -- __tests__/novelDecompositionPipeline.test.ts`

Expected: FAIL，当前日志不包含渠道与模型。

- [ ] **Step 3: 实现统一日志上下文**

在 `默认小说拆分执行器` 解析 `resolvedApiConfig` 后计算：

```ts
const 小说拆分接口身份 = 格式化小说拆分接口身份(resolvedApiConfig);
const 附加小说拆分接口身份 = (message: string): string => (
    `${message}（${小说拆分接口身份}）`
);
```

将其用于接口可用性失败、任务接入、分段开始、重试失败、最终失败和执行器结果。不要附加到 `streamText`。

- [ ] **Step 4: 运行后台测试确认 GREEN**

Run: `npm run test:run -- __tests__/novelDecompositionPipeline.test.ts __tests__/novelDecompositionApiDiagnostics.test.ts`

Expected: PASS，0 failures。

- [ ] **Step 5: 提交本任务**

```powershell
git add -- services/novelDecompositionRuntime.ts __tests__/novelDecompositionPipeline.test.ts
git commit -m "feat: 在小说分解进度中显示接口身份"
```

### Task 4: 集成验证与日间模式检查

**Files:**
- Modify only if verification finds a scoped defect: `components/features/Settings/NovelDecompositionApiSettings.tsx`

- [ ] **Step 1: 运行相关测试集**

Run: `npm run test:run -- __tests__/novelDecompositionApiDiagnostics.test.ts __tests__/novelDecompositionApiSettings.test.tsx __tests__/novelDecompositionPipeline.test.ts __tests__/workflowGraphSettings.test.tsx`

Expected: 所有目标测试 PASS，0 failures。

- [ ] **Step 2: 执行完整本地构建**

Run: `npm run build`

Expected: Vite build 退出码 0，无 TypeScript 或打包错误。

- [ ] **Step 3: 启动本地预览并检查日间模式**

使用隐藏后台进程启动有限范围的本地静态预览：

```powershell
Start-Process -FilePath python -ArgumentList '-m','http.server','4173','-d','dist' -WindowStyle Hidden
```

打开 `http://127.0.0.1:4173`，切换 day 主题，进入设置的小说分解接口页，确认：测试按钮文字清晰；成功/失败结果区域对比度足够；渠道和模型不被截断到无法识别；错误详情可换行阅读。

- [ ] **Step 4: 检查差异与敏感信息**

Run: `git diff --check`

Run: `pwsh -NoProfile -Command "$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new(); git diff | Select-String -Pattern 'apiKey|secret-key|Bearer' -Context 2,2"`

Expected: 无空白错误；只有字段名或测试占位值，没有真实密钥。

- [ ] **Step 5: 提交验证阶段的必要修正**

若日间模式检查产生了范围内修正：

```powershell
git add -- components/features/Settings/NovelDecompositionApiSettings.tsx
git commit -m "fix: 提升小说分解连接结果可读性"
```

若无修正，则不创建空提交。
