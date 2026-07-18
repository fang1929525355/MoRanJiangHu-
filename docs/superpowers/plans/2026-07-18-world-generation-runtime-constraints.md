# World Generation Runtime Constraints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让世界观生成以动态 `currencySystem` 为货币唯一真值，并在不剧透具体剧情的前提下读取模式包主线方向与暗线策略。

**Architecture:** 新建一个纯函数模块，集中负责动态货币提示词和世界观叙事约束的生成；世界观工作流只调用该模块并注入结果。开局运行时快照新增主线、暗线兼容字段，使没有标准叙事世界书条目的外部模式包也能恢复配置；原有开场和后续剧情世界书作用域保持不变。

**Tech Stack:** TypeScript、React 19、Vitest、Vite、Capacitor Android

---

## 文件结构

- Create: `prompts/runtime/worldGenerationRuntimeConstraints.ts` — 动态货币口径决策、模式世界书叙事字段提取、世界观阶段约束文本生成。
- Create: `__tests__/worldGenerationRuntimeConstraints.test.ts` — 上述纯函数的单币种、多币种、旧版回退、主线暗线与防剧透测试。
- Modify: `models/system.ts` — 为 `OpeningRuntimeSnapshot` 增加主线、暗线兼容快照字段。
- Modify: `utils/customNewGamePresets.ts` — 从所选模式包 payload 提取叙事字段并保存、恢复到运行时快照。
- Modify: `utils/openingConfig.ts` — 序列化和规范化新增快照字段。
- Modify: `__tests__/workshopOpeningRestore.test.ts` — 验证快速重开与预设直开不会丢失主线、暗线兼容字段。
- Modify: `utils/effectiveTopicProfile.ts` — 有动态货币时使用统一货币提示词，不再暴露旧 `exchangeRules`。
- Modify: `prompts/runtime/openingConfig.ts` — 题材提示词只输出已决策的货币口径。
- Modify: `utils/modeRuntimeProfile.ts` — 运行时世界书摘要在动态货币模式下不再先输出旧三层货币摘要。
- Modify: `components/features/Workshop/CreativeWorkshopModal.tsx` — 澄清 `exchangeRules` 仅为旧版兼容字段。
- Modify: `__tests__/modeRuntimePassthrough.test.ts` — 验证动态货币压制旧三层提示词。
- Modify: `hooks/useGame/worldGenerationWorkflow.ts` — 将专用世界观运行时约束块注入世界观生成请求。
- Modify: `__tests__/worldGenerationModePackageWorkflow.test.ts` — 验证实际工作流请求包含动态货币、主线和暗线约束。

### Task 1: 建立世界观运行时约束纯函数

**Files:**
- Create: `prompts/runtime/worldGenerationRuntimeConstraints.ts`
- Create: `__tests__/worldGenerationRuntimeConstraints.test.ts`

- [ ] **Step 1: 写单币种与旧版回退失败测试**

在新测试文件中创建最小运行时配置，并断言动态单币种完全压制旧三层说明：

```ts
import { describe, expect, it } from 'vitest';
import { 构建官方模式运行时配置 } from '../utils/modeRuntimeProfile';
import {
    构建世界观货币口径,
    构建模式包世界观叙事约束
} from '../prompts/runtime/worldGenerationRuntimeConstraints';

describe('世界观货币口径', () => {
    it('单币种 currencySystem 压制旧三层换算说明', () => {
        const runtime = 构建官方模式运行时配置('武侠');
        runtime.identity.modeId = 'custom-single-currency';
        runtime.identity.displayName = '单币种模式';
        runtime.economy.exchangeRules = '三层货币：铜钱、银子、金元宝。';
        runtime.economy.currencySystem = {
            id: 'credits',
            name: '信用点体系',
            baseUnitId: 'credit',
            units: [{
                id: 'credit', name: '信用点', symbol: 'CR', aliases: ['积分'],
                baseRate: 1, order: 0
            }]
        };

        const text = 构建世界观货币口径(runtime, '官方三层货币');
        expect(text).toContain('仅使用“信用点”');
        expect(text).toContain('不存在上层、中层、底层货币');
        expect(text).not.toContain('铜钱');
        expect(text).not.toContain('金元宝');
    });

    it('没有 currencySystem 时保留 exchangeRules 回退', () => {
        const runtime = 构建官方模式运行时配置('武侠');
        delete runtime.economy.currencySystem;
        runtime.economy.exchangeRules = '一两银等于一千文。';
        expect(构建世界观货币口径(runtime, '官方回退')).toBe('一两银等于一千文。');
    });
});
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `npm run test:run -- __tests__/worldGenerationRuntimeConstraints.test.ts`

Expected: FAIL，提示无法解析 `worldGenerationRuntimeConstraints` 或导出函数不存在。

- [ ] **Step 3: 实现最小货币口径函数**

在新模块中实现动态货币优先级。多币种按 `order`、`baseRate` 输出，单币种写出明确排他约束：

```ts
import type { ModeRuntimeProfile, OpeningRuntimeSnapshot } from '../../types';
import type { 世界书条目结构 } from '../../models/worldbook';

const 取文本 = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

export const 构建世界观货币口径 = (
    runtimeProfile: ModeRuntimeProfile | null | undefined,
    officialFallback: string
): string => {
    const currencySystem = runtimeProfile?.economy?.currencySystem;
    const units = currencySystem?.units
        ?.filter((unit) => unit && unit.name && Number.isFinite(unit.baseRate) && unit.baseRate > 0)
        .slice()
        .sort((a, b) => a.order - b.order);
    if (currencySystem && units?.length === 1) {
        const unit = units[0];
        const extras = [unit.symbol ? `符号=${unit.symbol}` : '', unit.aliases?.length ? `别名=${unit.aliases.join('、')}` : '']
            .filter(Boolean).join('；');
        return `本世界仅使用“${unit.name}”作为唯一记账与结算货币${extras ? `（${extras}）` : ''}；不存在上层、中层、底层货币及层级兑换；不得恢复基底题材的三层货币。`;
    }
    if (currencySystem && units && units.length > 1) {
        const baseUnit = units.find((unit) => unit.id === currencySystem.baseUnitId) || units[0];
        const relations = units.map((unit) => unit.id === baseUnit.id
            ? `${unit.name}=基础单位`
            : `1 ${unit.name}=${unit.baseRate} ${baseUnit.name}`);
        return `本世界使用“${currencySystem.name}”：${relations.join('；')}。所有价格与结算只使用这些单位，不得混入旧版货币层级。`;
    }
    return 取文本(runtimeProfile?.economy?.exchangeRules) || 取文本(officialFallback);
};
```

- [ ] **Step 4: 写多币种和叙事约束失败测试**

追加测试，构造带标准 ID 的主线、暗线世界书；断言输出保留方向但包含防剧透边界：

```ts
it('多币种按 baseRate 输出统一换算', () => {
    const runtime = 构建官方模式运行时配置('武侠');
    runtime.economy.currencySystem = {
        id: 'coins', name: '王国铸币', baseUnitId: 'copper',
        units: [
            { id: 'gold', name: '金币', symbol: 'G', aliases: [], baseRate: 10000, order: 2 },
            { id: 'copper', name: '铜币', symbol: 'C', aliases: [], baseRate: 1, order: 0 },
            { id: 'silver', name: '银币', symbol: 'S', aliases: [], baseRate: 100, order: 1 }
        ]
    };
    const text = 构建世界观货币口径(runtime, '旧说明');
    expect(text).toContain('1 银币=100 铜币');
    expect(text).toContain('1 金币=10000 铜币');
    expect(text).not.toContain('旧说明');
});

it('主线与暗线转换为不剧透的世界背景约束', () => {
    const snapshot = {
        modeWorldbooks: [{
            id: 'demo-worldbook', 标题: '演示世界书', 启用: true,
            条目: [
                {
                    id: 'demo-narrative-main-story', 标题: '主线方向',
                    内容: '【模式包主线方向】\n围绕市井生活和个人成长展开。',
                    类型: 'system_rule', 作用域: ['main', 'opening'], 注入模式: 'always', 启用: true
                },
                {
                    id: 'demo-narrative-hidden-plot', 标题: '暗线策略',
                    内容: '【模式包暗线策略】\n只保留轻量人情误会和可回收伏笔。',
                    类型: 'system_rule', 作用域: ['main', 'opening'], 注入模式: 'always', 启用: true
                }
            ]
        }]
    } satisfies OpeningRuntimeSnapshot;
    const text = 构建模式包世界观叙事约束(snapshot);
    expect(text).toContain('市井生活和个人成长');
    expect(text).toContain('轻量人情误会');
    expect(text).toContain('不得点名幕后黑手');
    expect(text).toContain('不生成玩家专属任务线');
});
```

- [ ] **Step 5: 实现叙事条目选择、清理和约束生成**

在同一模块增加以下规则：标准 ID 优先，标题兼容；过滤禁用和空内容；相同类别按优先级、更新时间选择一个；移除固定包装标题和“边界”尾段。

```ts
const 选择受管条目 = (
    snapshot: OpeningRuntimeSnapshot | null | undefined,
    suffix: string,
    title: string
): 世界书条目结构 | undefined => {
    const candidates = (snapshot?.modeWorldbooks || [])
        .filter((book) => book.启用 !== false)
        .flatMap((book) => book.条目 || [])
        .filter((entry) => entry.启用 !== false && 取文本(entry.内容))
        .filter((entry) => entry.id.endsWith(suffix) || entry.标题 === title)
        .sort((a, b) => {
            const idScore = Number(b.id.endsWith(suffix)) - Number(a.id.endsWith(suffix));
            if (idScore !== 0) return idScore;
            const priorityScore = (b.优先级 || 0) - (a.优先级 || 0);
            return priorityScore || (b.更新时间 || 0) - (a.更新时间 || 0);
        });
    return candidates[0];
};

const 清理受管叙事正文 = (content: string, heading: string): string => content
    .replace(new RegExp(`^【模式包${heading}】\\s*`), '')
    .replace(/\n+边界：[\s\S]*$/u, '')
    .trim();

export const 构建模式包世界观叙事约束 = (
    snapshot: OpeningRuntimeSnapshot | null | undefined
): string => {
    const mainEntry = 选择受管条目(snapshot, '-narrative-main-story', '主线方向');
    const hiddenEntry = 选择受管条目(snapshot, '-narrative-hidden-plot', '暗线策略');
    const main = mainEntry ? 清理受管叙事正文(mainEntry.内容, '主线方向') : 取文本(snapshot?.mainStoryDirection);
    const hidden = hiddenEntry ? 清理受管叙事正文(hiddenEntry.内容, '暗线策略') : 取文本(snapshot?.hiddenPlotPolicy);
    if (!main && !hidden) return '';
    return [
        '【模式包世界观生成约束】',
        main ? `- 主线承载方向：${main}` : '',
        main ? '- 只据此塑造社会结构、资源压力、冲突来源与可持续活动空间，不把主线写成已经发生的固定事件。' : '',
        hidden ? `- 暗线生长边界：${hidden}` : '',
        hidden ? '- 只据此塑造信息差、秘密与可回收伏笔的生长条件，不得点名幕后黑手、公开真相、确定最终反派或预告结局。' : '',
        '- 当前阶段只生成世界母本，不生成玩家专属任务线、主角专属机缘或围绕主角量身定做的世界。',
        '- 具体事件必须留给开场和后续回合依据玩家行动生成。'
    ].filter(Boolean).join('\n');
};
```

- [ ] **Step 6: 运行纯函数测试**

Run: `npm run test:run -- __tests__/worldGenerationRuntimeConstraints.test.ts`

Expected: PASS，全部货币与叙事约束测试通过。

- [ ] **Step 7: 提交纯函数与测试**

```bash
git add prompts/runtime/worldGenerationRuntimeConstraints.ts __tests__/worldGenerationRuntimeConstraints.test.ts
git commit -m "feat: 统一世界观运行时约束生成"
```

### Task 2: 保存和恢复主线、暗线兼容快照

**Files:**
- Modify: `models/system.ts:801`
- Modify: `utils/customNewGamePresets.ts:160-365`
- Modify: `utils/openingConfig.ts:703-766`
- Modify: `__tests__/workshopOpeningRestore.test.ts`
- Modify: `__tests__/openingConfigNormalization.test.ts`

- [ ] **Step 1: 写运行时快照恢复失败测试**

在 `workshopOpeningRestore.test.ts` 增加一个本地模式包，payload 只有兼容字段而没有叙事世界书条目，验证恢复结果：

```ts
it('从模式包 payload 保存主线和暗线兼容快照', () => {
    const topic = 创意工坊模块列表.find((entry) => entry.source === 'builtin' && entry.id === 'mode-package-现代都市');
    expect(topic).toBeTruthy();
    const restored = 获取快速重开运行时恢复参数({
        openingConfig: {
            题材模式: '现代都市',
            初始关系模板: '随机邂逅',
            关系侧重: ['友情'],
            开局切入偏好: '市井起手',
            开局生成门派: true,
            开局生成同门: true,
            同人融合: { enabled: false } as any,
            runtimeSnapshot: {
                workshopSelection: {
                    selectedMode: '现代都市',
                    selectedModules: { topic: 'builtin:mode-package-现代都市' }
                }
            }
        },
        validModuleKeys: new Set(['builtin:mode-package-现代都市'])
    });
    expect(restored.runtimeSnapshot?.mainStoryDirection).toBe((topic!.payload as any).mainStoryDirection);
    expect(restored.runtimeSnapshot?.hiddenPlotPolicy).toBe((topic!.payload as any).hiddenPlotPolicy);
});
```

在 `openingConfigNormalization.test.ts` 增加序列化测试：

```ts
expect(normalized.runtimeSnapshot?.mainStoryDirection).toBe('现实日常主线');
expect(normalized.runtimeSnapshot?.hiddenPlotPolicy).toBe('低强度暗线');
```

- [ ] **Step 2: 运行恢复测试并确认字段缺失**

Run: `npm run test:run -- __tests__/workshopOpeningRestore.test.ts __tests__/openingConfigNormalization.test.ts`

Expected: FAIL，`OpeningRuntimeSnapshot` 没有对应字段或规范化结果为 `undefined`。

- [ ] **Step 3: 扩展快照类型与构建参数**

在 `OpeningRuntimeSnapshot` 增加：

```ts
mainStoryDirection?: string;
hiddenPlotPolicy?: string;
```

给 `构建开局运行时快照` 参数和结果增加同名字段，并把空快照判定补充为：

```ts
mainStoryDirection: 标准化文本(params.mainStoryDirection),
hiddenPlotPolicy: 标准化文本(params.hiddenPlotPolicy),
```

只有字段非空时才应阻止快照被折叠为 `undefined`。

- [ ] **Step 4: 从所选 topic 模式包 payload 提取兼容字段**

在 `校准工坊运行时恢复结果` 中读取：

```ts
const topicPayload = topicEntry?.payload as any;
const mainStoryDirection = topicEntry
    ? 标准化文本(topicPayload?.mainStoryDirection)
    : 标准化文本(snapshot?.mainStoryDirection);
const hiddenPlotPolicy = topicEntry
    ? 标准化文本(topicPayload?.hiddenPlotPolicy)
    : 标准化文本(snapshot?.hiddenPlotPolicy);
```

把两项传给 `构建开局运行时快照`，并在恢复结果中返回，确保快速重开和预设直开沿用保存值。

- [ ] **Step 5: 更新开局配置规范化**

在 `规范化开局运行时快照` 中加入：

```ts
mainStoryDirection: 读取文本(raw?.mainStoryDirection),
hiddenPlotPolicy: 读取文本(raw?.hiddenPlotPolicy),
```

同步更新空快照判定，避免只含这两个字段的合法快照被清除。

- [ ] **Step 6: 运行快照相关测试**

Run: `npm run test:run -- __tests__/workshopOpeningRestore.test.ts __tests__/openingConfigNormalization.test.ts __tests__/worldGenerationRuntimeConstraints.test.ts`

Expected: PASS，payload 兼容字段经过保存、规范化和恢复后仍可被约束生成函数读取。

- [ ] **Step 7: 提交快照兼容修改**

```bash
git add models/system.ts utils/customNewGamePresets.ts utils/openingConfig.ts __tests__/workshopOpeningRestore.test.ts __tests__/openingConfigNormalization.test.ts
git commit -m "fix: 保留模式包叙事运行时快照"
```

### Task 3: 让所有题材提示词只使用统一货币口径

**Files:**
- Modify: `utils/effectiveTopicProfile.ts:86-142`
- Modify: `prompts/runtime/openingConfig.ts:12-34`
- Modify: `utils/modeRuntimeProfile.ts:1103-1122`
- Modify: `components/features/Workshop/CreativeWorkshopModal.tsx:76`
- Modify: `__tests__/modeRuntimePassthrough.test.ts`

- [ ] **Step 1: 写动态货币污染失败测试**

在 `modeRuntimePassthrough.test.ts` 添加：

```ts
it('题材提示词有动态单币种时不输出旧三层换算', () => {
    const runtime = 构建红楼运行时配置({
        economy: {
            exchangeRules: '三层货币：制钱、银两、金锭。',
            currencySystem: {
                id: 'cash', name: '现银', baseUnitId: 'cash-yuan',
                units: [{
                    id: 'cash-yuan', name: '银元', symbol: '元', aliases: [],
                    baseRate: 1, order: 0
                }]
            }
        }
    });
    const text = 构建题材模式提示词({
        题材模式: '武侠', modeRuntimeProfile: runtime
    } as any);
    expect(text).toContain('仅使用“银元”');
    expect(text).not.toContain('制钱、银两、金锭');
});
```

再断言 `渲染模式运行时配置世界书内容(runtime)` 在动态模式下不输出 `上层/中层/底层` 的旧摘要。

- [ ] **Step 2: 运行测试确认旧 exchangeRules 仍泄漏**

Run: `npm run test:run -- __tests__/modeRuntimePassthrough.test.ts`

Expected: FAIL，题材提示词仍包含旧三层说明。

- [ ] **Step 3: 在有效题材配置中使用统一货币函数**

导入 `构建世界观货币口径`，在自定义 runtime 分支中只计算一次：

```ts
const currencyRules = 构建世界观货币口径(runtimeProfile, official.currencyExchangePrompt);
```

将 `runtimePromptLines` 的“统一换算口径”和返回对象的 `currencyExchangePrompt` 都改为 `currencyRules`。`currencyPrompt` 仍保留作者的题材货币说明，但不能再拼接旧汇率。

- [ ] **Step 4: 避免运行时世界书摘要并列两套货币**

在 `渲染模式运行时配置世界书内容` 中按是否存在 `currencySystem` 选择一条摘要：

```ts
const economySummary = profile.economy.currencySystem
    ? `经济系统：市场=${profile.economy.marketName}；行为=${profile.economy.marketVerb}；${渲染动态货币体系摘要(profile.economy.currencySystem)}`
    : `经济系统：市场=${profile.economy.marketName}；行为=${profile.economy.marketVerb}；上层=${profile.economy.currencyTiers.upperName}；中层=${profile.economy.currencyTiers.middleName}；底层=${profile.economy.currencyTiers.lowerName}；汇率=${profile.economy.currencyTiers.upperToMiddleRate}/${profile.economy.currencyTiers.middleToLowerRate}`;
```

数组中只放 `economySummary`，删除独立的动态货币摘要项，避免重复。

- [ ] **Step 5: 澄清编辑器旧字段标签**

把经济配置字段标签从“旧兼容换算说明”调整为：

```ts
{ label: '旧版换算说明（仅无 currencySystem 时生效）', path: ['economy', 'exchangeRules'], type: 'textarea' }
```

不增加新的 UI 或自动改写用户文本。

- [ ] **Step 6: 运行题材与货币测试**

Run: `npm run test:run -- __tests__/modeRuntimePassthrough.test.ts __tests__/worldGenerationRuntimeConstraints.test.ts __tests__/currencyDisplay.test.tsx`

Expected: PASS；显示、题材提示词和运行时世界书均使用同一动态货币配置，旧模式测试保持通过。

- [ ] **Step 7: 提交货币提示词接线修改**

```bash
git add utils/effectiveTopicProfile.ts prompts/runtime/openingConfig.ts utils/modeRuntimeProfile.ts components/features/Workshop/CreativeWorkshopModal.tsx __tests__/modeRuntimePassthrough.test.ts
git commit -m "fix: 动态货币接管世界观提示词"
```

### Task 4: 将主线与暗线约束接入世界观生成工作流

**Files:**
- Modify: `hooks/useGame/worldGenerationWorkflow.ts:456-535`
- Modify: `__tests__/worldGenerationModePackageWorkflow.test.ts`

- [ ] **Step 1: 写世界观请求失败测试**

沿用该测试文件现有的 AI service mock，给 `openingConfig.runtimeSnapshot` 放入主线、暗线条目和单币种 runtime，然后断言传给 `generateWorldFoundationData` 的上下文参数：

```ts
expect(worldContext).toContain('本世界仅使用“信用点”');
expect(worldExtraPrompt).toContain('【模式包世界观生成约束】');
expect(worldExtraPrompt).toContain('市井生活和个人成长');
expect(worldExtraPrompt).toContain('轻量人情误会');
expect(worldExtraPrompt).toContain('不得点名幕后黑手');
expect(`${worldContext}\n${worldExtraPrompt}`).not.toContain('铜钱、银子、金元宝');
```

同时保留现有断言，证明世界观生成后仍进入正常开场流程。

- [ ] **Step 2: 运行工作流测试确认叙事约束缺失**

Run: `npm run test:run -- __tests__/worldGenerationModePackageWorkflow.test.ts`

Expected: FAIL，`worldGenerationExtraPrompt` 不包含模式包世界观约束。

- [ ] **Step 3: 构建并注入专用约束块**

在工作流导入：

```ts
import { 构建模式包世界观叙事约束 } from '../../prompts/runtime/worldGenerationRuntimeConstraints';
```

在构建 `worldGenerationExtraPrompt` 前计算：

```ts
const modeNarrativeWorldConstraint = 构建模式包世界观叙事约束(
    effectiveOpeningConfig?.runtimeSnapshot
);
```

把 `modeNarrativeWorldConstraint` 放在 `fandomPromptBundle.世界观创建补丁` 之后、境界参考之前。这样题材与同人硬口径先建立，叙事方向随后约束世界结构，玩家世界观草稿仍在末尾以更高优先级重复强调。

- [ ] **Step 4: 运行工作流与相关回归测试**

Run: `npm run test:run -- __tests__/worldGenerationModePackageWorkflow.test.ts __tests__/worldGenerationRuntimeConstraints.test.ts __tests__/workshopDraftRoundTrip.test.ts __tests__/workshopOpeningRestore.test.ts`

Expected: PASS；世界观请求包含约束，同时模式包编辑、保存和恢复测试没有回归。

- [ ] **Step 5: 提交工作流接线修改**

```bash
git add hooks/useGame/worldGenerationWorkflow.ts __tests__/worldGenerationModePackageWorkflow.test.ts
git commit -m "fix: 世界观生成承接模式包主线暗线"
```

### Task 5: 完整验证 Web 与 Android 使用同一逻辑

**Files:**
- Verify only: all files changed in Tasks 1-4
- Generated locally: `dist/`
- Generated locally: `android/app/src/main/assets/public/`

- [ ] **Step 1: 运行目标测试集**

Run:

```bash
npm run test:run -- __tests__/worldGenerationRuntimeConstraints.test.ts __tests__/worldGenerationModePackageWorkflow.test.ts __tests__/modeRuntimePassthrough.test.ts __tests__/workshopOpeningRestore.test.ts __tests__/openingConfigNormalization.test.ts __tests__/workshopDraftRoundTrip.test.ts __tests__/currencyDisplay.test.tsx
```

Expected: PASS，所有目标测试通过。

- [ ] **Step 2: 运行完整测试集**

Run: `npm run test:run`

Expected: PASS，无新增失败；如存在与本改动无关的既有失败，记录完整测试名和错误，不得将其描述为通过。

- [ ] **Step 3: 构建 Web**

Run: `npm run build`

Expected: exit code 0，`dist/` 生成新的 `assets/index-*.js`，构建无 TypeScript/Vite 错误。

- [ ] **Step 4: 同步 Android 静态资源**

Run: `npm run apk:sync`

Expected: exit code 0，Capacitor 完成 Android 同步；这只是本地同步，不构建发布 APK、不上传、不部署。

- [ ] **Step 5: 比较 Web 与 Android 主 bundle**

使用 PowerShell 7：

```powershell
$web = Get-ChildItem dist/assets/index-*.js | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$apk = Get-ChildItem android/app/src/main/assets/public/assets/index-*.js | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$webHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $web.FullName).Hash
$apkHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $apk.FullName).Hash
if ($web.Name -ne $apk.Name -or $webHash -ne $apkHash) { throw "Web 与 Android bundle 不一致" }
"MATCH $($web.Name) $webHash"
```

Expected: 输出 `MATCH index-*.js <SHA256>`，证明 Web 与 Android 使用同一套提示词代码。

- [ ] **Step 6: 检查工作区，排除生成物和用户文件**

Run: `git status --short`

Expected: 只显示预期源代码与测试改动；不得暂存 `.reasonix/`、`dist/`、Android 构建产物、日志或截图。

- [ ] **Step 7: 提交最终验证所需的剩余源代码修改**

若前面任务已按计划逐项提交且没有剩余源代码修改，则跳过提交；否则只提交遗漏的源代码和测试：

```bash
git add prompts/runtime/worldGenerationRuntimeConstraints.ts prompts/runtime/openingConfig.ts hooks/useGame/worldGenerationWorkflow.ts utils/effectiveTopicProfile.ts utils/modeRuntimeProfile.ts utils/customNewGamePresets.ts utils/openingConfig.ts models/system.ts components/features/Workshop/CreativeWorkshopModal.tsx __tests__/worldGenerationRuntimeConstraints.test.ts __tests__/worldGenerationModePackageWorkflow.test.ts __tests__/modeRuntimePassthrough.test.ts __tests__/workshopOpeningRestore.test.ts __tests__/openingConfigNormalization.test.ts
git commit -m "test: 验证世界观运行时约束一致性"
```

## 完成条件

- 单币种世界观不再出现题材预设三层货币。
- 多币种提示词与 `currencySystem` 的单位、顺序和基础倍率一致。
- 主线和暗线参与世界观母本生成，但不会形成具体任务、幕后真相或固定结局。
- 原有 `opening`、`main`、`story_plan`、`heroine_plan` 和 `world_evolution` 世界书注入行为保持不变。
- 旧版无 `currencySystem` 的模式包继续使用 `exchangeRules`。
- 目标测试、完整测试、Web 构建和 Android 资源同步均有明确验证结果。
- 未经用户明确要求，不执行发布、上传或部署。
