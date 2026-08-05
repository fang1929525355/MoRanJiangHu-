# 小说模式包逐分段累积完善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将小说分解模式包的单次摘要补全改为按 `分段列表` 顺序累积完善、可暂停续跑、最终一致性整理的长任务。

**Architecture:** 新增独立的模式包完善进度模型、IndexedDB 设置存储和顺序工作流；AI 层提供“首段建骨架 / 后续段修订 / 最终整理”三类请求。设置界面通过专用 hook 驱动工作流，持续展示持久化进度，并只在最终完成后把草稿交给现有模式包生成与贡献逻辑。

**Tech Stack:** React 18、TypeScript、Vitest、IndexedDB 设置存储、现有 OpenAI-compatible 请求层与小说分解数据模型。

---

## 文件结构

- Create: `models/novelModePackCompletion.ts` — 累积完善状态、阶段和持久化记录类型。
- Create: `services/novelModePackCompletionStore.ts` — 数据集指纹、记录标准化、读取、保存、删除。
- Create: `services/novelModePackCompletionWorkflow.ts` — 顺序执行、重试、暂停续跑和最终整理。
- Create: `hooks/useNovelModePackCompletion.ts` — React 状态同步、取消控制和界面操作入口。
- Modify: `utils/settingsSchema.ts` — 增加模式包完善进度设置键。
- Modify: `prompts/runtime/novelModePackCompletion.ts` — 增加逐段和最终整理提示词构建器。
- Modify: `services/ai/storyTasks.ts` — 增加单分段累积完善和最终整理 AI 请求函数。
- Modify: `services/novelDecompositionWorkshopBridge.ts` — 导出统一题材清洗入口并包装 AI 结果。
- Modify: `components/features/Settings/NovelDecompositionSettings.tsx` — 替换一次性按钮、展示进度、限制半成品生成与贡献。
- Test: `__tests__/novelModePackCompletionStore.test.ts`
- Test: `__tests__/novelModePackProgressivePrompt.test.ts`
- Test: `__tests__/novelModePackCompletionWorkflow.test.ts`
- Test: `__tests__/novelModePackCompletionUiState.test.tsx`
- Modify Test: `__tests__/novelModePackCompletion.test.ts`
- Modify Test: `__tests__/novelDecompositionWorkshopBridge.test.ts`

### Task 1: 定义累积完善进度模型与设置键

**Files:**
- Create: `models/novelModePackCompletion.ts`
- Modify: `utils/settingsSchema.ts`
- Test: `__tests__/novelModePackCompletionStore.test.ts`

- [ ] **Step 1: 写进度标准化的失败测试**

在 `__tests__/novelModePackCompletionStore.test.ts` 创建测试，先引用尚不存在的标准化函数：

```ts
import { describe, expect, it } from 'vitest';
import { 标准化小说模式包完善记录 } from '../services/novelModePackCompletionStore';

describe('小说模式包累积完善记录', () => {
    it('把越界游标和无效状态规范为可继续的暂停记录', () => {
        expect(标准化小说模式包完善记录({
            id: 'dataset-1::武侠',
            数据集ID: 'dataset-1',
            题材: '武侠',
            数据集指纹: 'fingerprint',
            状态: 'broken',
            当前阶段: 'segment',
            总分段数: 3,
            已完成分段数: 2,
            下一个分段索引: 99,
            当前草稿: { economy: { primaryCurrency: '铜钱' } }
        })).toEqual(expect.objectContaining({
            状态: 'paused',
            当前阶段: 'segment',
            总分段数: 3,
            已完成分段数: 2,
            下一个分段索引: 2
        }));
    });
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm run test:run -- __tests__/novelModePackCompletionStore.test.ts`

Expected: FAIL，提示找不到 `services/novelModePackCompletionStore` 或导出函数。

- [ ] **Step 3: 添加明确的进度类型**

创建 `models/novelModePackCompletion.ts`：

```ts
import type { ModeRuntimeProfile, 题材模式类型 } from './system';

export type 小说模式包完善状态 = 'idle' | 'running' | 'paused' | 'finalizing' | 'completed';
export type 小说模式包完善阶段 = 'skeleton' | 'segment' | 'finalize';

export interface 小说模式包分段输入记录 {
    分段ID: string;
    原文总字符数: number;
    实际输入字符数: number;
    是否完整输入: boolean;
}

export interface 小说模式包完善记录 {
    id: string;
    数据集ID: string;
    题材: 题材模式类型;
    数据集指纹: string;
    状态: 小说模式包完善状态;
    当前阶段: 小说模式包完善阶段;
    总分段数: number;
    已完成分段数: number;
    下一个分段索引: number;
    最近失败分段索引?: number;
    最近错误?: string;
    当前分段标题?: string;
    分段输入记录: 小说模式包分段输入记录[];
    待整理冲突提示: string[];
    当前草稿: Partial<ModeRuntimeProfile>;
    用户确认字段路径: string[];
    最近原始输出?: string;
    createdAt: number;
    updatedAt: number;
}
```

在 `utils/settingsSchema.ts` 的 `设置键` 对象中新增：

```ts
小说模式包完善进度: '小说模式包完善进度',
```

- [ ] **Step 4: 实现最小标准化函数**

创建 `services/novelModePackCompletionStore.ts`，先实现测试所需部分：

```ts
import type { 小说模式包完善记录, 小说模式包完善状态, 小说模式包完善阶段 } from '../models/novelModePackCompletion';

const 读取状态 = (value: unknown): 小说模式包完善状态 => (
    value === 'idle' || value === 'running' || value === 'paused' || value === 'finalizing' || value === 'completed'
        ? value
        : 'paused'
);

const 读取阶段 = (value: unknown): 小说模式包完善阶段 => (
    value === 'skeleton' || value === 'segment' || value === 'finalize' ? value : 'skeleton'
);

export const 标准化小说模式包完善记录 = (raw: any): 小说模式包完善记录 => {
    const 总分段数 = Math.max(0, Math.floor(Number(raw?.总分段数) || 0));
    const 已完成分段数 = Math.min(总分段数, Math.max(0, Math.floor(Number(raw?.已完成分段数) || 0)));
    const 下一个分段索引 = Math.min(总分段数, Math.max(0, Math.floor(Number(raw?.下一个分段索引) || 已完成分段数)));
    const now = Date.now();
    return {
        id: String(raw?.id || ''),
        数据集ID: String(raw?.数据集ID || ''),
        题材: raw?.题材,
        数据集指纹: String(raw?.数据集指纹 || ''),
        状态: 读取状态(raw?.状态),
        当前阶段: 读取阶段(raw?.当前阶段),
        总分段数,
        已完成分段数,
        下一个分段索引,
        最近失败分段索引: Number.isInteger(raw?.最近失败分段索引) ? raw.最近失败分段索引 : undefined,
        最近错误: typeof raw?.最近错误 === 'string' ? raw.最近错误 : undefined,
        当前分段标题: typeof raw?.当前分段标题 === 'string' ? raw.当前分段标题 : undefined,
        分段输入记录: Array.isArray(raw?.分段输入记录) ? raw.分段输入记录 : [],
        待整理冲突提示: Array.isArray(raw?.待整理冲突提示)
            ? raw.待整理冲突提示.filter((hint: unknown): hint is string => typeof hint === 'string')
            : [],
        当前草稿: raw?.当前草稿 && typeof raw.当前草稿 === 'object' ? raw.当前草稿 : {},
        用户确认字段路径: Array.isArray(raw?.用户确认字段路径)
            ? raw.用户确认字段路径.filter((path: unknown): path is string => typeof path === 'string')
            : [],
        最近原始输出: typeof raw?.最近原始输出 === 'string' ? raw.最近原始输出 : undefined,
        createdAt: Number(raw?.createdAt) || now,
        updatedAt: Number(raw?.updatedAt) || now
    };
};
```

- [ ] **Step 5: 运行测试并确认 GREEN**

Run: `npm run test:run -- __tests__/novelModePackCompletionStore.test.ts`

Expected: PASS，1 test passed。

- [ ] **Step 6: 提交类型和设置键**

```bash
git add models/novelModePackCompletion.ts services/novelModePackCompletionStore.ts utils/settingsSchema.ts __tests__/novelModePackCompletionStore.test.ts
git commit -m "feat: 定义小说模式包累积完善进度"
```

### Task 2: 实现数据集指纹与进度持久化

**Files:**
- Modify: `services/novelModePackCompletionStore.ts`
- Modify: `__tests__/novelModePackCompletionStore.test.ts`

- [ ] **Step 1: 写指纹变化与 CRUD 失败测试**

追加测试：

```ts
import { beforeEach, vi } from 'vitest';
import { 创建空小说拆分数据集 } from '../services/novelDecompositionStore';
import {
    删除小说模式包完善记录,
    构建小说模式包数据集指纹,
    读取小说模式包完善记录,
    保存小说模式包完善记录
} from '../services/novelModePackCompletionStore';
import * as dbService from '../services/dbService';

beforeEach(() => vi.restoreAllMocks());

it('分段内容变化会改变数据集指纹', async () => {
    const dataset = 创建空小说拆分数据集({ 标题: '测试小说' });
    dataset.分段列表 = [{
        id: 'seg-1',
        数据集ID: dataset.id,
        组号: 1,
        标题: '第一段',
        原文内容: '甲',
        updatedAt: 1
    } as any];
    const first = await 构建小说模式包数据集指纹(dataset);
    dataset.分段列表[0].原文内容 = '乙';
    const second = await 构建小说模式包数据集指纹(dataset);
    expect(second).not.toBe(first);
});

it('按数据集和题材保存、读取并删除记录', async () => {
    let stored: unknown = [];
    vi.spyOn(dbService, '读取设置').mockImplementation(async () => stored as any);
    vi.spyOn(dbService, '保存设置').mockImplementation(async (_key, value) => { stored = value; });
    const record = 标准化小说模式包完善记录({
        id: 'dataset-1::武侠', 数据集ID: 'dataset-1', 题材: '武侠', 数据集指纹: 'fp',
        状态: 'paused', 当前阶段: 'segment', 总分段数: 2, 已完成分段数: 1,
        下一个分段索引: 1, 当前草稿: {}
    });
    await 保存小说模式包完善记录(record);
    expect(await 读取小说模式包完善记录('dataset-1', '武侠')).toEqual(record);
    await 删除小说模式包完善记录('dataset-1', '武侠');
    expect(await 读取小说模式包完善记录('dataset-1', '武侠')).toBeNull();
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm run test:run -- __tests__/novelModePackCompletionStore.test.ts`

Expected: FAIL，缺少指纹和 CRUD 导出。

- [ ] **Step 3: 实现稳定 SHA-256 指纹**

在 store 中加入：

```ts
import type { 小说拆分数据集结构 } from '../models/novelDecomposition';

export const 构建小说模式包数据集指纹 = async (dataset: 小说拆分数据集结构): Promise<string> => {
    const source = JSON.stringify({
        id: dataset.id,
        segments: (dataset.分段列表 || []).map((segment) => ({
            id: segment.id,
            title: segment.标题,
            text: segment.原文内容,
            updatedAt: segment.updatedAt
        }))
    });
    const bytes = new TextEncoder().encode(source);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
```

- [ ] **Step 4: 实现设置存储 CRUD**

使用 `dbService.读取设置`、`dbService.保存设置` 和 `设置键.小说模式包完善进度` 保存记录数组。保存时按 `数据集ID + 题材` 替换，删除时只移除目标记录；读取后必须逐项调用标准化函数。

- [ ] **Step 5: 运行 store 测试**

Run: `npm run test:run -- __tests__/novelModePackCompletionStore.test.ts`

Expected: PASS，3 tests passed。

- [ ] **Step 6: 提交持久化实现**

```bash
git add services/novelModePackCompletionStore.ts __tests__/novelModePackCompletionStore.test.ts
git commit -m "feat: 持久化模式包逐段完善进度"
```

### Task 3: 增加逐分段提示词和 AI 请求

**Files:**
- Modify: `prompts/runtime/novelModePackCompletion.ts`
- Modify: `services/ai/storyTasks.ts`
- Test: `__tests__/novelModePackProgressivePrompt.test.ts`
- Modify: `__tests__/novelModePackCompletion.test.ts`

- [ ] **Step 1: 写三阶段提示词失败测试**

创建 `__tests__/novelModePackProgressivePrompt.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import {
    构建小说模式包分段完善用户提示词,
    构建小说模式包最终整理用户提示词
} from '../prompts/runtime/novelModePackCompletion';

describe('小说模式包逐段完善提示词', () => {
    it('后续分段同时包含上一版完整草稿和当前分段原文', () => {
        const prompt = 构建小说模式包分段完善用户提示词({
            workName: '测试小说',
            baseMode: '武侠',
            segmentIndex: 1,
            totalSegments: 3,
            segment: { 标题: '第二段', 原文内容: '后文确认通用货币是银票。', 世界观规则: ['银票通行天下。'] } as any,
            currentDraft: { economy: { primaryCurrency: '铜钱' } },
            confirmedFieldPaths: ['economy.primaryCurrency']
        });
        expect(prompt).toContain('后文确认通用货币是银票');
        expect(prompt).toContain('"primaryCurrency":"铜钱"');
        expect(prompt).toContain('economy.primaryCurrency');
        expect(prompt).toContain('用户确认字段不得覆盖');
        expect(prompt).toContain('输出更新后的完整模式包草稿');
    });

    it('最终整理禁止凭空新增设定', () => {
        const prompt = 构建小说模式包最终整理用户提示词({
            workName: '测试小说',
            baseMode: '武侠',
            currentDraft: { economy: { primaryCurrency: '银票' } }
        });
        expect(prompt).toContain('不得新增没有证据的设定');
        expect(prompt).toContain('"primaryCurrency":"银票"');
    });
});
```

- [ ] **Step 2: 运行提示词测试并确认 RED**

Run: `npm run test:run -- __tests__/novelModePackProgressivePrompt.test.ts`

Expected: FAIL，两个构建函数不存在。

- [ ] **Step 3: 实现有界分段摘要构建器**

在提示词文件中新增参数类型，并把当前分段的 `原文内容`、`本组概括`、角色/势力/地点/物品档案、世界观规则、关系、时间线序列化。构建器返回提示文本以及输入统计，原文使用明确常量限制单轮输入，例如：

```ts
const 模式包单段原文最大字符数 = 24_000;

const 构建当前分段证据 = (segment: 小说拆分分段结构): string => JSON.stringify({
    标题: segment.标题,
    章节范围: segment.章节范围,
    原文内容: (segment.原文内容 || '').slice(0, 模式包单段原文最大字符数),
    本组概括: segment.本组概括,
    角色档案: segment.角色档案,
    势力档案: segment.势力档案,
    地图地点档案: segment.地图地点档案,
    物品档案: segment.物品档案,
    世界观规则: segment.世界观规则,
    世界边界规则: segment.世界边界规则,
    人物关系: segment.人物关系,
    势力关系: segment.势力关系,
    时间线: segment.时间线
});
```

同时计算 `{ 原文总字符数, 实际输入字符数, 是否完整输入 }`，由 AI 请求结果返回给工作流并持久化，禁止静默截断。首段提示写明“建立骨架”，后续段提示写明“基于上一版完整草稿补充、纠错、删除被推翻项，并输出完整 JSON”。参数同时接收 `confirmedFieldPaths`；提示词将这些路径列为用户确认值，要求后续轮次和最终整理不得覆盖。每轮输出额外允许返回结构化 `conflictHints: string[]`，供最终整理使用；最终整理只传草稿、累计冲突提示与确认路径，禁止新增设定。

- [ ] **Step 4: 增加 AI 请求函数的失败测试**

在 `__tests__/novelModePackCompletion.test.ts` 中模拟两次 fetch，断言第二次请求体包含第一轮草稿，并分别测试：

```ts
const first = await generateNovelModePackSegmentCompletion({
    dataset, segmentIndex: 0, baseMode: '武侠', currentDraft: {}, confirmedFieldPaths: []
}, apiConfig, { stream: false });
const second = await generateNovelModePackSegmentCompletion({
    dataset, segmentIndex: 1, baseMode: '武侠', currentDraft: first.completion, confirmedFieldPaths: []
}, apiConfig, { stream: false });
expect(second.completion.economy?.primaryCurrency).toBe('银票');
```

同时为 `generateNovelModePackFinalization` 增加一项解析测试。

- [ ] **Step 5: 运行 AI 请求测试并确认 RED**

Run: `npm run test:run -- __tests__/novelModePackCompletion.test.ts __tests__/novelModePackProgressivePrompt.test.ts`

Expected: FAIL，缺少逐段和最终整理请求函数。

- [ ] **Step 6: 实现逐段与最终整理请求**

在 `services/ai/storyTasks.ts` 新增：

```ts
export const generateNovelModePackSegmentCompletion = async (
    params: {
        dataset: 小说拆分数据集结构;
        segmentIndex: number;
        baseMode: 题材模式类型;
        currentDraft: Record<string, any>;
        confirmedFieldPaths: string[];
    },
    apiConfig: 当前可用接口结构,
    streamOptions?: WorldStreamOptions,
    signal?: AbortSignal
): Promise<NovelModePackCompletionResult> => {
    const segment = params.dataset.分段列表[params.segmentIndex];
    if (!segment) throw new Error(`模式包完善分段不存在：${params.segmentIndex + 1}`);
    const { prompt, inputStats } = 构建小说模式包分段完善用户提示词({
        workName: params.dataset.作品名 || params.dataset.标题,
        baseMode: params.baseMode,
        segmentIndex: params.segmentIndex,
        totalSegments: params.dataset.分段列表.length,
        segment,
        currentDraft: params.currentDraft,
        confirmedFieldPaths: params.confirmedFieldPaths
    });
    const rawText = await 请求模型文本(apiConfig, 规范化文本补全消息链([
        { role: 'system', content: 小说模式包补全系统提示词 },
        { role: 'user', content: prompt }
    ], { 保留System: true, 合并同角色: false }), {
        temperature: 0.3,
        streamOptions,
        signal
    });
    const { completion, conflictHints } = 解析小说模式包逐段补全JSON(rawText);
    return { completion, rawText, conflictHints, inputStats };
};
```

扩展逐段请求结果为 `{ completion, rawText, conflictHints, inputStats }`；解析不到可用 `completion` 时必须抛错，不能推进进度。最终整理函数使用更低温度 `0.15`，只传当前草稿、累计冲突提示和 `confirmedFieldPaths`。

- [ ] **Step 7: 运行测试并确认 GREEN**

Run: `npm run test:run -- __tests__/novelModePackCompletion.test.ts __tests__/novelModePackProgressivePrompt.test.ts`

Expected: PASS。

- [ ] **Step 8: 提交提示词与 AI 层**

```bash
git add prompts/runtime/novelModePackCompletion.ts services/ai/storyTasks.ts __tests__/novelModePackCompletion.test.ts __tests__/novelModePackProgressivePrompt.test.ts
git commit -m "feat: 支持模式包按小说分段累积完善"
```

### Task 4: 导出每轮统一题材清洗入口

**Files:**
- Modify: `services/novelDecompositionWorkshopBridge.ts`
- Modify: `__tests__/novelDecompositionWorkshopBridge.test.ts`

- [ ] **Step 1: 写每轮过滤失败测试**

追加测试，直接调用期望的新导出：

```ts
import { 清洗小说模式包累积草稿 } from '../services/novelDecompositionWorkshopBridge';

it('每轮累积草稿都会过滤无证据的末日和无限流模板', () => {
    const dataset = 创建空小说拆分数据集({
        标题: '普通武侠',
        世界边界规则: ['不得出现主神空间、丧尸或避难所。']
    });
    const cleaned = 清洗小说模式包累积草稿(dataset, '武侠', {
        economy: { primaryCurrency: '奖励点' },
        map: { locationTypes: ['感染区', '客栈'] },
        image: { visualStyle: '写实末日风' },
        time: { calendarName: '大梁历' }
    });
    expect(JSON.stringify(cleaned)).not.toMatch(/奖励点|感染区|写实末日风/u);
    expect(cleaned.time?.calendarName).toBe('大梁历');
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm run test:run -- __tests__/novelDecompositionWorkshopBridge.test.ts`

Expected: FAIL，新导出不存在。

- [ ] **Step 3: 导出薄包装函数**

复用现有 `解析小说模式包题材`、`小说拆分疑似无限流题材` 和 `清理AI补全草稿配置`：

```ts
export const 清洗小说模式包累积草稿 = (
    dataset: 小说拆分数据集结构,
    baseMode: 题材模式类型,
    draft: Partial<ModeRuntimeProfile>
): Partial<ModeRuntimeProfile> => {
    const resolvedMode = 解析小说模式包题材(dataset, baseMode);
    const hasInfiniteEvidence = resolvedMode === '无限流' || 小说拆分疑似无限流题材(dataset);
    return 清理AI补全草稿配置(draft, resolvedMode, hasInfiniteEvidence);
};
```

同时让现有 `AI补全小说模式包配置` 调用该函数，避免两套清洗逻辑分叉。

- [ ] **Step 4: 运行 bridge 与旧补全测试**

Run: `npm run test:run -- __tests__/novelDecompositionWorkshopBridge.test.ts __tests__/novelModePackCompletion.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交统一清洗入口**

```bash
git add services/novelDecompositionWorkshopBridge.ts __tests__/novelDecompositionWorkshopBridge.test.ts
git commit -m "refactor: 统一模式包累积草稿题材清洗"
```

### Task 5: 实现可暂停续跑的顺序工作流

**Files:**
- Create: `services/novelModePackCompletionWorkflow.ts`
- Test: `__tests__/novelModePackCompletionWorkflow.test.ts`

- [ ] **Step 1: 写三分段累积修订失败测试**

创建测试并使用依赖注入，不 mock 全局 fetch：

```ts
import { describe, expect, it, vi } from 'vitest';
import { 执行小说模式包逐段完善 } from '../services/novelModePackCompletionWorkflow';

it('依次处理三段并允许后文纠正前文货币', async () => {
    const saved: any[] = [];
    const completeSegment = vi.fn()
        .mockResolvedValueOnce({ completion: { economy: { primaryCurrency: '铜钱' } }, rawText: 'first' })
        .mockResolvedValueOnce({ completion: { economy: { primaryCurrency: '铜钱' }, ability: { primaryAxis: '武学境界' } }, rawText: 'second' })
        .mockResolvedValueOnce({ completion: { economy: { primaryCurrency: '银票' }, ability: { primaryAxis: '武学境界' } }, rawText: 'third' });
    const result = await 执行小说模式包逐段完善({
        dataset,
        baseMode: '武侠',
        initialRecord: null,
        signal: new AbortController().signal,
        completeSegment,
        finalize: async ({ currentDraft }) => ({ completion: currentDraft, rawText: 'final' }),
        sanitize: (_dataset, _mode, draft) => draft,
        save: async (record) => { saved.push(structuredClone(record)); }
    });
    expect(completeSegment).toHaveBeenCalledTimes(3);
    expect(result.当前草稿.economy?.primaryCurrency).toBe('银票');
    expect(result.状态).toBe('completed');
    expect(saved.some((item) => item.已完成分段数 === 1)).toBe(true);
});
```

- [ ] **Step 2: 写失败暂停和继续测试**

同一测试文件增加：第二段连续失败超过重试次数后，结果为 `paused`、`下一个分段索引 === 1`、第一段草稿仍在；将该记录作为 `initialRecord` 再执行时，断言第一段不会重新调用。

再增加“人工确认字段续跑”用例：暂停记录包含手动修改后的 `当前草稿` 和 `用户确认字段路径`，继续时断言两者都传入第二段 AI 请求；AI 即使返回不同值，合并后的草稿仍保留用户确认值。

- [ ] **Step 3: 写最终整理可重试测试**

构造 `下一个分段索引 === 总分段数` 的记录，让 finalize 抛错，断言状态保持 `finalizing`；再次执行只调用 finalize，不调用分段函数。

- [ ] **Step 4: 运行测试并确认 RED**

Run: `npm run test:run -- __tests__/novelModePackCompletionWorkflow.test.ts`

Expected: FAIL，工作流模块不存在。

- [ ] **Step 5: 实现工作流依赖和重试函数**

定义明确依赖类型：

```ts
type 逐段完善依赖 = {
    completeSegment: (params: {
        dataset: 小说拆分数据集结构;
        segmentIndex: number;
        baseMode: 题材模式类型;
        currentDraft: Partial<ModeRuntimeProfile>;
        confirmedFieldPaths: string[];
        signal: AbortSignal;
    }) => Promise<NovelModePackCompletionResult>;
    finalize: (params: {
        dataset: 小说拆分数据集结构;
        baseMode: 题材模式类型;
        currentDraft: Partial<ModeRuntimeProfile>;
        conflictHints: string[];
        confirmedFieldPaths: string[];
        signal: AbortSignal;
    }) => Promise<NovelModePackCompletionResult>;
    sanitize: typeof 清洗小说模式包累积草稿;
    save: (record: 小说模式包完善记录) => Promise<void>;
};
```

重试只捕获普通错误；`AbortError` 立即转为暂停，不继续重试。默认总尝试次数使用 3 次，延迟使用 `500ms`、`1500ms`，测试通过注入零延迟函数避免真实等待。

- [ ] **Step 6: 实现逐段循环和每段落盘**

核心推进规则：

```ts
for (let index = record.下一个分段索引; index < dataset.分段列表.length; index += 1) {
    const result = await 带重试执行(() => dependencies.completeSegment({
        dataset,
        segmentIndex: index,
        baseMode,
        currentDraft: record.当前草稿,
        confirmedFieldPaths: record.用户确认字段路径,
        signal
    }), signal, dependencies.wait);
    record = {
        ...record,
        状态: 'running',
        当前阶段: index === 0 ? 'skeleton' : 'segment',
        当前分段标题: dataset.分段列表[index].标题,
        分段输入记录: [...record.分段输入记录, {
            分段ID: dataset.分段列表[index].id,
            ...result.inputStats
        }],
        待整理冲突提示: [...record.待整理冲突提示, ...result.conflictHints],
        当前草稿: dependencies.sanitize(dataset, baseMode, result.completion),
        最近原始输出: result.rawText,
        已完成分段数: index + 1,
        下一个分段索引: index + 1,
        最近失败分段索引: undefined,
        最近错误: undefined,
        updatedAt: Date.now()
    };
    await dependencies.save(record);
}
```

任何分段失败时保存 `paused`、失败索引和错误后返回记录。不得推进游标。每轮 AI 结果清洗后，还要用通用路径读取/写入工具把 `用户确认字段路径` 对应的旧值覆盖回新草稿，确保人工确认值不会被模型改写；最终整理后执行同一保护步骤。

- [ ] **Step 7: 实现最终整理阶段**

全部分段完成后先保存 `finalizing`，把 `待整理冲突提示` 和用户确认字段传给 finalize，再清洗并保存 `completed`。finalize 失败时保存错误并保留 `finalizing`，下次从 finalize 继续。

- [ ] **Step 8: 运行工作流测试并确认 GREEN**

Run: `npm run test:run -- __tests__/novelModePackCompletionWorkflow.test.ts`

Expected: PASS，覆盖顺序、暂停续跑、取消和最终整理。

- [ ] **Step 9: 提交工作流**

```bash
git add services/novelModePackCompletionWorkflow.ts __tests__/novelModePackCompletionWorkflow.test.ts
git commit -m "feat: 增加模式包逐段完善续跑工作流"
```

### Task 6: 建立 React hook 并恢复持久化进度

**Files:**
- Create: `hooks/useNovelModePackCompletion.ts`
- Test: `__tests__/novelModePackCompletionUiState.test.tsx`

- [ ] **Step 1: 写 hook 恢复与取消失败测试**

使用现有 React 测试方式渲染测试组件，断言：传入数据集后读取对应题材记录；调用 `cancel` 会 abort 当前请求但保留草稿；调用 `restart` 会先删除记录并从第 0 段开始。

测试暴露的 hook API 必须固定为：

```ts
type UseNovelModePackCompletionResult = {
    record: 小说模式包完善记录 | null;
    draft: Partial<ModeRuntimeProfile> | null;
    running: boolean;
    log: string;
    start: () => Promise<void>;
    resume: () => Promise<void>;
    restart: () => Promise<void>;
    updateDraft: (draft: Partial<ModeRuntimeProfile>, changedPaths: string[]) => Promise<void>;
    cancel: () => void;
};
```

- [ ] **Step 2: 运行 hook 测试并确认 RED**

Run: `npm run test:run -- __tests__/novelModePackCompletionUiState.test.tsx`

Expected: FAIL，hook 不存在。

- [ ] **Step 3: 实现记录加载和状态同步**

hook 接收 `dataset`、`baseMode`、`apiConfig`、`onNotify`。在数据集 ID 或题材变化时读取记录并校验数据集指纹；指纹不匹配时保留记录供 UI 提示，但禁止 `resume`。

- [ ] **Step 4: 实现 start、resume、restart、cancel**

- `start`：没有有效记录时创建新记录并执行工作流。
- `resume`：只使用指纹匹配且未完成的记录。
- `restart`：删除目标记录、清除本地状态、创建新 AbortController 后从头执行。
- `updateDraft`：仅在非请求执行期保存人工编辑后的完整草稿，把本次变化路径去重合并进 `用户确认字段路径`；后续 `resume` 从持久化记录读取这些确认值。
- `cancel`：只调用当前 AbortController.abort，不删除记录。

工作流依赖连接到 `generateNovelModePackSegmentCompletion`、`generateNovelModePackFinalization`、`清洗小说模式包累积草稿` 和 store 保存函数。测试还要断言请求运行中调用 `updateDraft` 会被拒绝，避免与正在返回的 AI 结果发生竞态；用户可先取消/等待暂停后编辑再继续。

- [ ] **Step 5: 运行 hook 测试并确认 GREEN**

Run: `npm run test:run -- __tests__/novelModePackCompletionUiState.test.tsx`

Expected: PASS。

- [ ] **Step 6: 提交 hook**

```bash
git add hooks/useNovelModePackCompletion.ts __tests__/novelModePackCompletionUiState.test.tsx
git commit -m "feat: 管理模式包逐段完善界面状态"
```

### Task 7: 替换设置界面的一次性补全入口

**Files:**
- Modify: `components/features/Settings/NovelDecompositionSettings.tsx`
- Modify: `__tests__/novelModePackCompletionUiState.test.tsx`

- [ ] **Step 1: 写按钮与发布门禁失败测试**

增加组件级测试，构造 `paused`、`running`、`completed` 三类记录，断言：

- paused 显示“继续完善”和“从头重建”；
- running 显示“取消”和 `正在完善第 2 / 5 分段`；
- running 同时显示当前分段标题；若该段原文被截断，明确显示“本段输入已按上限截断”，不得只在日志中记录；
- completed 才启用“生成模式包”和“贡献模式包”；
- 非 completed 显示“仍有分段未参与完善”。
- paused/finalizing 允许编辑当前草稿；编辑后保存变化字段路径，继续运行时用户值不会被覆盖。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm run test:run -- __tests__/novelModePackCompletionUiState.test.tsx`

Expected: FAIL，现有 UI 仍显示一次性“AI 补全模式包”。

- [ ] **Step 3: 用 hook 替换本地一次性状态**

移除 `aiCompletionRunning` 的一次性调用处理器，保留 `aiCompletionDraft` 作为完成后编辑态；从 hook 解构：

```ts
const modePackCompletion = useNovelModePackCompletion({
    dataset: selectedDataset,
    baseMode: modePackageTopic,
    apiConfig: 获取小说拆分接口配置(form),
    onNotify
});
```

当 `record?.状态 === 'completed'` 时把 `record.当前草稿` 同步到现有 `aiCompletionDraft`；其他状态只展示草稿，不进入生成/贡献参数。复用现有模式包字段编辑器时，把字段变化路径和完整草稿交给 `updateDraft`；请求运行中禁用编辑，暂停、最终整理失败和完成状态允许编辑。

- [ ] **Step 4: 增加进度展示和操作按钮**

统一桌面与移动区域，展示：

```tsx
<div className="text-xs text-gray-300">
    {record?.当前阶段 === 'finalize'
        ? '正在进行最终一致性整理'
        : `正在完善第 ${Math.min((record?.下一个分段索引 || 0) + 1, record?.总分段数 || 0)} / ${record?.总分段数 || 0} 分段`}
</div>
```

百分比只按完成分段数计算；最终整理期间显示 100% 分段完成但状态仍为整理中。

- [ ] **Step 5: 增加从头重建确认**

复用项目现有确认弹窗；确认文案明确“将清除当前模式包完善草稿和分段进度，不影响小说分解数据集”。只有确认后调用 `restart`。

- [ ] **Step 6: 阻止半成品生成与贡献**

在现有生成和贡献处理器开头加入统一判断：

```ts
if (modePackCompletion.record?.状态 !== 'completed') {
    推送错误提示('模式包仍有分段未参与完善，请先继续完成全部分段和最终整理。');
    return;
}
```

按钮的 `disabled` 条件同步加入该判断。不要只依赖按钮禁用，防止其他调用路径绕过。

- [ ] **Step 7: 运行 UI 测试和题材选择测试**

Run: `npm run test:run -- __tests__/novelModePackCompletionUiState.test.tsx __tests__/novelDecompositionTopicSelection.test.tsx`

Expected: PASS。

- [ ] **Step 8: 提交界面改造**

```bash
git add components/features/Settings/NovelDecompositionSettings.tsx __tests__/novelModePackCompletionUiState.test.tsx
git commit -m "feat: 展示模式包逐段完善进度与续跑入口"
```

### Task 8: 验证兼容性、长流程和生产构建

**Files:**
- Modify when required by failures: files changed in Tasks 1-7 only

- [ ] **Step 1: 运行模式包和小说分解相关测试**

Run:

```bash
npm run test:run -- \
  __tests__/novelModePackCompletionStore.test.ts \
  __tests__/novelModePackProgressivePrompt.test.ts \
  __tests__/novelModePackCompletionWorkflow.test.ts \
  __tests__/novelModePackCompletionUiState.test.tsx \
  __tests__/novelModePackCompletion.test.ts \
  __tests__/novelDecompositionWorkshopBridge.test.ts \
  __tests__/novelDecompositionTopicSelection.test.tsx
```

Expected: 全部 PASS，0 failed。

- [ ] **Step 2: 运行完整单元测试**

为避免外部 AI 环境导致非确定性，先清空仅用于真实端测的三个环境变量：

```powershell
$env:MORAN_E2E_AI_BASE_URL=''
$env:MORAN_E2E_AI_API_KEY=''
$env:MORAN_E2E_AI_MODEL=''
npm run test:run -- --reporter=dot
```

Expected: exit 0，0 failed。

- [ ] **Step 3: 单独运行已配置的真实 AI 端测（若本机有配置）**

恢复用户环境变量后运行：

Run: `npm run test:run -- __tests__/aiReturnedNameE2E.test.ts --reporter=verbose`

Expected: 配置存在时真实调用 PASS；配置不存在时相关用例 SKIP。

- [ ] **Step 4: 运行 TypeScript 检查**

Run: `npx tsc --noEmit --pretty false`

Expected: 本次涉及文件零新增类型错误；若仓库存在历史错误，保存基线并用文件路径比对确认无新增。

- [ ] **Step 5: 运行生产构建**

Run: `npm run build`

Expected: exit 0，Vite production build 成功。

- [ ] **Step 6: 检查工作树只包含预期文件**

Run: `git status --short`

Expected: 只包含 Tasks 1-7 列出的源文件和测试文件；不得包含 `dist/`、测试结果、日志、截图或 APK。

- [ ] **Step 7: 提交最终验证修正**

如果验证过程中无需修正，不创建空提交；如有范围内修正：

```bash
git add models/novelModePackCompletion.ts services/novelModePackCompletionStore.ts services/novelModePackCompletionWorkflow.ts hooks/useNovelModePackCompletion.ts prompts/runtime/novelModePackCompletion.ts services/ai/storyTasks.ts services/novelDecompositionWorkshopBridge.ts components/features/Settings/NovelDecompositionSettings.tsx utils/settingsSchema.ts __tests__/novelModePackCompletionStore.test.ts __tests__/novelModePackProgressivePrompt.test.ts __tests__/novelModePackCompletionWorkflow.test.ts __tests__/novelModePackCompletionUiState.test.tsx __tests__/novelModePackCompletion.test.ts __tests__/novelDecompositionWorkshopBridge.test.ts
git commit -m "test: 完善模式包逐段生成回归验证"
```

## 完成检查

- 每个分段按顺序进入一次 AI 完善调用。
- 第一段建立骨架，后续分段能够修改而不只是追加。
- 每轮 AI 输出在写入和传给下一轮前经过题材清洗。
- 每段记录原文是否完整进入模型；发生截断时 UI 明确提示。
- 暂停时的人工修改会记录确认字段路径，续跑和最终整理都不会覆盖这些值。
- 每段完成后立即持久化，失败和取消可以继续。
- 数据集或题材变化会阻止错误续跑。
- 最终整理失败只重试整理阶段。
- 未完成草稿不能生成或贡献模式包。
- 桌面和移动区域提供开始、继续、从头重建和取消操作。
- 相关测试、完整测试、类型检查和生产构建通过。
- 不执行版本更新、APK 构建、上传或部署。
