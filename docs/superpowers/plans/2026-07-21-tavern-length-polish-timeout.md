# 酒馆预设字数例外与文章优化超时 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让酒馆预设遵守玩家最低字数设置，并让普通回合和开局文章优化在流式连接挂起时可靠收束或超时失败。

**Architecture:** 酒馆预设分支在预设消息链末尾追加独立用户字数消息，不恢复其他项目提示词。文章优化新增独立的请求超时封装，组合父级取消信号、首次响应计时和流式空闲计时；完整正文可在连接挂起时作为草稿返回，不完整正文则抛错进入现有阶段重试流程。

**Tech Stack:** TypeScript、React hooks、Vitest、OpenAI-compatible SSE

---

### Task 1: 酒馆预设最低字数例外

**Files:**
- Modify: `__tests__/storyLengthValidation.test.ts`
- Modify: `hooks/useGame/mainStoryRequest.ts`

- [ ] **Step 1: 将现有酒馆预设测试改为失败测试**

把“酒馆预设模式下不注入项目字数要求”测试改为断言：消息链包含独立 `tavern_length_requirement` 用户消息，其内容包含 `2200字以上`，同时仍不包含输出协议和风格助手。

```ts
expect(result.messageEntries).toContainEqual(expect.objectContaining({
    id: 'tavern_length_requirement',
    role: 'user',
    content: expect.stringContaining('2200字以上')
}));
expect(result.orderedMessages.some((message) => message.content.includes('输出协议'))).toBe(false);
```

- [ ] **Step 2: 运行测试并确认因字数消息缺失而失败**

Run: `npm run test:run -- __tests__/storyLengthValidation.test.ts`

Expected: FAIL，找不到 `tavern_length_requirement`。

- [ ] **Step 3: 在酒馆预设消息链末尾追加字数消息**

在 `构建主剧情请求参数` 的酒馆分支完成预设消息映射后追加：

```ts
if (lengthRequirementPrompt.trim()) {
    messageEntries.push({
        id: 'tavern_length_requirement',
        title: '酒馆预设字数要求',
        category: '用户',
        role: 'user',
        content: lengthRequirementPrompt.trim()
    });
}
```

同步注释为“酒馆预设接管项目叙事指令，但最低字数作为玩家硬设置例外保留”。

- [ ] **Step 4: 运行字数与预设测试**

Run: `npm run test:run -- __tests__/storyLengthValidation.test.ts __tests__/tavernPresetTakeover.test.ts __tests__/tavernPresetCompat.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交任务 1**

```bash
git add __tests__/storyLengthValidation.test.ts hooks/useGame/mainStoryRequest.ts
git commit -m "fix: 酒馆预设保留玩家字数要求"
```

### Task 2: 文章优化请求超时守卫

**Files:**
- Create: `hooks/useGame/polishRequestTimeout.ts`
- Create: `__tests__/polishRequestTimeout.test.ts`
- Modify: `hooks/useGame/bodyPolish.ts`

- [ ] **Step 1: 编写超时守卫失败测试**

覆盖四个行为：无首包超时、收到片段后空闲超时、完整闭合正文后挂起时返回草稿、父级取消保持 `AbortError`。使用 Vitest fake timers，并让任务 Promise 监听传入的 `AbortSignal`。

```ts
const result = 执行文章优化请求带超时({
    parentSignal: new AbortController().signal,
    firstResponseTimeoutMs: 1000,
    streamIdleTimeoutMs: 500,
    task: async (signal, onDelta) => {
        onDelta('<正文>完整正文</正文>');
        return new Promise<string>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
    }
});
await vi.advanceTimersByTimeAsync(500);
await expect(result).resolves.toBe('<正文>完整正文</正文>');
```

- [ ] **Step 2: 运行测试并确认模块缺失**

Run: `npm run test:run -- __tests__/polishRequestTimeout.test.ts`

Expected: FAIL，无法导入 `polishRequestTimeout`。

- [ ] **Step 3: 实现独立超时封装**

导出以下接口：

```ts
export type 文章优化请求超时参数<T> = {
    parentSignal: AbortSignal;
    firstResponseTimeoutMs: number;
    streamIdleTimeoutMs: number;
    task: (signal: AbortSignal, onDelta: (delta: string, accumulated: string) => void) => Promise<T>;
    resolveCompletedDraft: (accumulated: string) => T | null;
};

export const 执行文章优化请求带超时 = async <T>(params: 文章优化请求超时参数<T>): Promise<T> => {
    if (params.parentSignal.aborted) throw params.parentSignal.reason;
    const controller = new AbortController();
    let accumulated = '';
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    return new Promise<T>((resolve, reject) => {
        const clearTimer = () => {
            if (timer) clearTimeout(timer);
            timer = null;
        };
        const finish = (callback: () => void) => {
            if (settled) return;
            settled = true;
            clearTimer();
            params.parentSignal.removeEventListener('abort', abortByParent);
            callback();
        };
        const abortByParent = () => finish(() => {
            controller.abort(params.parentSignal.reason);
            reject(params.parentSignal.reason);
        });
        const startTimer = (timeoutMs: number, label: string) => {
            clearTimer();
            timer = setTimeout(() => {
                const draft = params.resolveCompletedDraft(accumulated);
                if (draft !== null) {
                    finish(() => resolve(draft));
                } else {
                    finish(() => reject(new Error(`文章优化${label}（${Math.ceil(timeoutMs / 1000)} 秒）`)));
                }
                controller.abort(new DOMException(label, 'AbortError'));
            }, timeoutMs);
        };

        params.parentSignal.addEventListener('abort', abortByParent, { once: true });
        startTimer(params.firstResponseTimeoutMs, '等待首次响应超时');
        params.task(controller.signal, (delta, current) => {
            accumulated = current || `${accumulated}${delta}`;
            startTimer(params.streamIdleTimeoutMs, '流式输出空闲超时');
        }).then(
            (value) => finish(() => resolve(value)),
            (error) => finish(() => reject(error))
        );
    });
};
```

首次增量前使用 `firstResponseTimeoutMs`；每次增量后改用并重置 `streamIdleTimeoutMs`。超时且 `resolveCompletedDraft` 返回结果时先 resolve 草稿再 abort 底层请求；否则 reject 包含阶段名称的超时错误。`finally` 清理计时器与父信号监听。

- [ ] **Step 4: 运行超时单元测试**

Run: `npm run test:run -- __tests__/polishRequestTimeout.test.ts`

Expected: 4 tests PASS。

- [ ] **Step 5: 在正文润色中接入守卫**

`执行正文润色` 使用 `获取游玩请求超时毫秒(runtimeGameConfig.游玩请求超时设置)`。每次调用 `generatePolishedBody` 时，把原有 `guardedOnDelta` 包进超时封装的 `onDelta`；`resolveCompletedDraft` 仅在累计文本包含闭合 `<正文>...</正文>` 时生成与正常请求相同的 `{ bodyText, rawText }` 结果。非流式调用不触发增量，因此由首次响应计时器限制整个请求。

- [ ] **Step 6: 运行文章优化现有回归测试**

Run: `npm run test:run -- __tests__/qualityAndDirectiveFixes.test.ts __tests__/openingBodyPolishE2E.test.ts __tests__/polishRequestTimeout.test.ts`

Expected: PASS。

- [ ] **Step 7: 提交任务 2**

```bash
git add hooks/useGame/polishRequestTimeout.ts hooks/useGame/bodyPolish.ts __tests__/polishRequestTimeout.test.ts
git commit -m "fix: 为文章优化增加流式空闲超时"
```

### Task 3: 联合验证

**Files:**
- Verify only

- [ ] **Step 1: 运行相关测试集合**

Run: `npm run test:run -- __tests__/storyLengthValidation.test.ts __tests__/qualityAndDirectiveFixes.test.ts __tests__/openingBodyPolishE2E.test.ts __tests__/polishRequestTimeout.test.ts`

Expected: 全部 PASS。

- [ ] **Step 2: 运行生产构建**

Run: `npm run build`

Expected: exit code 0，Vite 输出 `built`。

- [ ] **Step 3: 检查差异与工作区**

Run: `git diff --check` 和 `git status --short`

Expected: 无空白错误；`.reasonix/` 仍未跟踪且未进入任何提交。

- [ ] **Step 4: 不发布**

本任务没有新的“发布/部署”指令，不执行版本升级、APK 构建、上传或 Cloudflare 部署。
