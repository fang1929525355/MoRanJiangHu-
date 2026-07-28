# Dialogue Speaker Connective Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复正文校验把“而是”等叙事连接词误判为人物名，确保保留草稿可以重新解析并应用。

**Architecture:** 保持恢复弹窗和历史回合重建流程不变，在公共说话人可信度守卫中补齐叙事连接词排除，并让无标签动作行提取器复用该分类函数。解析器继续执行严格对白格式检查，真实未标记对白仍会被拦截。

**Tech Stack:** TypeScript、Vitest、Vite、React 19

---

### Task 1: 添加误判回归测试

**Files:**
- Modify: `__tests__/storyResponseParser.test.ts`

- [x] **Step 1: Write the failing test**

```ts
it('does not mistake narrative connectives before quoted speech for character names', () => {
    const parsed = parseStoryRawText([
        '<正文>',
        '【旁白】苏辰没有急着饮茶，而是看着水面倒映的烛火，沉默片刻后开口：“凡儿这孩子，心思太重。”',
        '</正文>',
        '<短期记忆>苏辰谈起凡儿。</短期记忆>'
    ].join('\n'), { validateDialogueFormat: true });

    expect(parsed.logs[0]?.sender).toBe('旁白');
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- __tests__/storyResponseParser.test.ts -t "does not mistake narrative connectives"`

Expected: FAIL，并包含 `疑似角色「而是」`。

### Task 2: 收紧公共说话人守卫

**Files:**
- Modify: `services/ai/storyResponseParser.ts`
- Modify: `utils/dialogueSpeakerGuard.ts`
- Test: `__tests__/storyResponseParser.test.ts`

- [x] **Step 1: Write minimal implementation**

新增整词匹配的叙事连接词正则，并让 `提取无标签动作行人物名` 调用 `是否疑似叙事短语标签`：

```ts
而是|但是|可是|不过|于是|因此|所以|因为|并非|却是
```

不要把这些连接词加入无条件前缀正则，避免把真实姓名“于是之”误判为叙事短语。

- [x] **Step 2: Run focused tests**

Run: `npm run test:run -- __tests__/storyResponseParser.test.ts`

Expected: PASS；现有真实未标记对白测试继续通过。

- [x] **Step 3: Protect real-name prefixes**

添加“【于是之】”应作为人物对白解析，以及“于是之……开口：‘……’”仍应触发未标记对白错误的测试。

- [x] **Step 4: Reject connective-plus-pronoun extraction candidates**

在启发式说话人提取层排除“于是他、而是他、因此便”等组合，并覆盖旁白引号与相邻动作行两条路径；正式人物标签守卫继续只对连接词做整词匹配。

- [x] **Step 5: Close arbitrary connective-prefix candidates**

连接词前缀候选默认按叙事短语拒绝，仅对角色名单/已知人物或明确中文姓名例外放行；单复数代词、指代词和叙事副词后缀强制排除。

- [x] **Step 6: Keep declared-name context through trust checks**

旁白引号提取的最终说话人可信度判断继续传递 `declaredNames`，保证已声明四字人物与动作行检测行为一致。

### Task 3: 完整验证

**Files:**
- Verify: `utils/dialogueSpeakerGuard.ts`
- Verify: `__tests__/storyResponseParser.test.ts`

- [x] **Step 1: Run the deterministic test suite**

Run: `npx vitest run --exclude __tests__/aiReturnedNameE2E.test.ts --exclude __tests__/openingBodyPolishE2E.test.ts --exclude __tests__/death-judgment-e2e.test.ts --exclude __tests__/extraPromptWordBanE2E.test.ts`

Expected: 所有确定性测试通过，0 failures；真实外部 AI E2E 的网络或模型波动单独记录。

- [x] **Step 2: Run the production build**

Run: `npm run build`

Expected: Vite build exits with code 0。

- [x] **Step 3: Review the diff**

Run: `git diff --check` and `git diff -- utils/dialogueSpeakerGuard.ts __tests__/storyResponseParser.test.ts`

Expected: 无空白错误；每处代码变更都直接对应本次误判修复。
