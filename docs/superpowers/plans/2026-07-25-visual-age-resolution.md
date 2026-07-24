# Unified Visual Age Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让真实年龄与视觉年龄分离，使仙侠、无限流等超凡角色的外貌、生图锚点和剧情称呼遵循题材、能力与明确外貌事实，同时保持现实人物和未成年安全规则。

**Architecture:** 新建纯函数模块 `utils/visualAge.ts`，集中解析题材、真实年龄、明确外观年龄、境界档位、种族和状态，输出统一的视觉年龄结果与提示词约束。NPC 上下文、NPC 生图、主角生图和自动角色锚点只消费解析结果，不再各自猜测年龄；手动锚点保持用户控制，自动锚点通过视觉年龄签名判定是否过期。

**Tech Stack:** TypeScript 5.8、React 19、Vitest 3、Vite 6、现有 `OpeningConfig` / `ModeRuntimeProfile` / 题材与境界配置工具。

---

## File Structure

- Create: `utils/visualAge.ts` — 视觉年龄类型、解析规则、图像标签、叙事约束和签名生成的唯一实现。
- Create: `__tests__/visualAge.test.ts` — 纯解析器的题材、境界、老态、种族和未成年边界测试。
- Modify: `models/character.ts` — 主角可选 `外观年龄` 字段。
- Modify: `models/social.ts` — NPC 可选 `外观年龄` 和 `境界层级` 字段。
- Modify: `models/system.ts` — 自动锚点可选视觉年龄签名字段。
- Modify: `utils/variableRegistry.ts` — 允许变量系统更新 `外观年龄`，但不要求旧存档补写。
- Modify: `hooks/useGame/npcContext.ts` — 生图基础数据和剧情 NPC 上下文携带外观年龄、境界层级、状态与统一叙事约束。
- Modify: `hooks/useGame/npcImageWorkflow.ts` — 删除本地年龄猜测，所有正负标签和最终强制词组消费同一个解析结果。
- Modify: `hooks/useGame/playerImageWorkflow.ts` — 主角通过同一 NPC 生图入口传入题材配置和视觉年龄上下文。
- Modify: `hooks/useGame/imagePresetWorkflow.ts` — AI 自动锚点写入视觉年龄签名，手动锚点不自动改写。
- Modify: `hooks/useGame/image/manualImageActionsWorkflow.ts` — NPC 私密部位生图在入队前执行真实年龄与幼态安全检查。
- Modify: `hooks/useGame.ts` — 向 NPC、主角与锚点工作流传递当前 `OpeningConfig`。
- Modify: `hooks/useGame/systemPromptBuilder.ts` — 主角序列化保留明确外观年龄。
- Modify: `__tests__/npcImageWorkflow.test.ts` — 验证最终提示词不再被真实岁数覆盖。
- Modify: `__tests__/playerImageWorkflow.test.ts` — 验证主角传递相同题材上下文，并仅刷新过期自动锚点。
- Modify: `__tests__/manualImageActionsWorkflow.test.ts` — 验证未成年和成年幼态 NPC 不能提交私密生图。
- Modify: `__tests__/worldbookSystemPrompt.test.ts` — 验证剧情上下文区分真实年龄、视觉年龄和身份称呼。

### Task 1: Build the Pure Visual Age Resolver

**Files:**
- Create: `utils/visualAge.ts`
- Create: `__tests__/visualAge.test.ts`

- [ ] **Step 1: Write the failing resolver tests**

Create `__tests__/visualAge.test.ts` with table-driven cases that pin the agreed precedence rules:

```ts
import { describe, expect, it } from 'vitest';
import { 解析视觉年龄 } from '../utils/visualAge';

describe('解析视觉年龄', () => {
    it('keeps an 85-year-old golden-core cultivator visually mature rather than elderly', () => {
        const result = 解析视觉年龄({
            actualAge: 85,
            topicMode: '仙侠',
            realmName: '金丹四层',
            realmLevel: 16,
            identity: '玉仙宗巡查使',
            appearance: '身姿挺拔，动作敏捷，面容清冷'
        });

        expect(result.visualAgeBand).toBe('mature_adult');
        expect(result.suggestedVisualAge).toBeGreaterThanOrEqual(32);
        expect(result.suggestedVisualAge).toBeLessThanOrEqual(40);
        expect(result.positiveTags).not.toContain('85 years old');
        expect(result.negativeTags).toContain('elderly appearance');
    });

    it('lets explicit current old age override high realm', () => {
        const result = 解析视觉年龄({
            actualAge: 85,
            topicMode: '仙侠',
            realmName: '金丹四层',
            realmLevel: 16,
            appearance: '寿元将尽，面容枯槁，皱纹纵横'
        });

        expect(result.visualAgeBand).toBe('elderly');
        expect(result.positiveTags).toContain('elderly appearance');
    });

    it('uses realistic aging for an unenhanced infinite-flow civilian', () => {
        const result = 解析视觉年龄({
            actualAge: 85,
            topicMode: '无限流',
            identity: '未强化的现实世界普通人'
        });

        expect(result.visualAgeBand).toBe('elderly');
        expect(result.source).toBe('realistic');
    });

    it('uses supernatural evidence for an enhanced infinite-flow veteran', () => {
        const result = 解析视觉年龄({
            actualAge: 85,
            topicMode: '无限流',
            identity: '资深轮回者',
            profileText: '完成基因强化并兑换青春药剂，身体机能保持巅峰'
        });

        expect(result.visualAgeBand).toBe('mature_adult');
        expect(result.source).toBe('supernatural');
    });

    it('does not treat elder titles as old-face evidence', () => {
        const result = 解析视觉年龄({
            actualAge: 85,
            topicMode: '仙侠',
            realmLevel: 20,
            identity: '宗门长老、太上老祖'
        });

        expect(result.visualAgeBand).not.toBe('elderly');
    });

    it('never adultifies a real minor because of realm', () => {
        const result = 解析视觉年龄({ actualAge: 16, topicMode: '仙侠', realmLevel: 40 });

        expect(result.visualAgeBand).toBe('late_teen');
        expect(result.isAdultForPrivateImage).toBe(false);
    });

    it('blocks private images for an adult with explicit childlike appearance', () => {
        const result = 解析视觉年龄({
            actualAge: 200,
            topicMode: '仙侠',
            explicitVisualAge: '幼童外貌'
        });

        expect(result.explicitYouthfulAppearance).toBe(true);
        expect(result.isAdultForPrivateImage).toBe(false);
    });
});
```

- [ ] **Step 2: Run the resolver tests and verify failure**

Run: `npm run test:run -- __tests__/visualAge.test.ts`

Expected: FAIL because `../utils/visualAge` does not exist.

- [ ] **Step 3: Implement the resolver types and precedence**

Create `utils/visualAge.ts` with these public contracts:

```ts
import type { ModeRuntimeProfile, 题材模式类型 } from '../models/system';
import { 获取题材模式配置 } from './topicModeProfiles';

export type VisualAgeBand =
    | 'child'
    | 'early_teen'
    | 'late_teen'
    | 'young_adult'
    | 'mature_adult'
    | 'middle_aged'
    | 'elderly'
    | 'unknown';

export interface VisualAgeContext {
    actualAge?: number;
    explicitVisualAge?: number | string;
    topicMode?: 题材模式类型 | string | null;
    runtimeProfile?: ModeRuntimeProfile | null;
    realmName?: string;
    realmLevel?: number;
    species?: string;
    identity?: string;
    appearance?: string;
    profileText?: string;
    statusText?: string;
}

export interface VisualAgeResolution {
    actualAge?: number;
    visualAgeBand: VisualAgeBand;
    suggestedVisualAge?: number;
    source: 'explicit' | 'appearance' | 'status' | 'species' | 'supernatural' | 'realistic' | 'unknown';
    reasons: string[];
    positiveTags: string[];
    negativeTags: string[];
    narrativeConstraints: string[];
    explicitYouthfulAppearance: boolean;
    isAdultForPrivateImage: boolean;
}

export const 解析视觉年龄 = (context: VisualAgeContext): VisualAgeResolution => {
    const actualAge = Number.isFinite(context.actualAge)
        ? Math.max(0, Math.floor(context.actualAge as number))
        : undefined;
    const evidence = [context.explicitVisualAge, context.species, context.identity, context.appearance, context.profileText, context.statusText]
        .map((item) => String(item ?? '').trim()).filter(Boolean).join(' ');
    const explicitText = String(context.explicitVisualAge ?? '').trim();
    const explicitNumber = typeof context.explicitVisualAge === 'number' && Number.isFinite(context.explicitVisualAge)
        ? Math.max(0, Math.floor(context.explicitVisualAge))
        : undefined;
    const group = 获取题材模式配置(context.topicMode).group;
    const hasOldEvidence = 明确老态.test(evidence);
    const hasChildlikeEvidence = 明确幼态.test(explicitText || evidence);
    const hasLongevityEvidence = 超凡维持.test(evidence) || 长寿种族.test(String(context.species ?? ''));
    const meaningfulRealm = Number.isFinite(context.realmLevel) && (context.realmLevel as number) >= 9;

    if (actualAge !== undefined && actualAge < 18) {
        return 从年龄构建结果(actualAge, 'realistic', ['真实年龄未成年，安全规则优先']);
    }
    if (hasChildlikeEvidence) {
        return 从分段构建结果('child', explicitNumber, 'explicit', ['档案明确为幼态外观'], {
            explicitYouthfulAppearance: true,
            isAdultForPrivateImage: false
        }, actualAge);
    }
    if (hasOldEvidence || (explicitNumber !== undefined && explicitNumber >= 65)) {
        return 从分段构建结果('elderly', explicitNumber ?? 70, explicitText ? 'explicit' : 'status', ['档案明确当前老态'], {}, actualAge);
    }
    if (explicitNumber !== undefined) {
        return 从年龄构建结果(explicitNumber, 'explicit', ['使用明确外观年龄'], actualAge);
    }
    if (/青年|年轻|三十岁|成熟青年/u.test(explicitText)) {
        return 从分段构建结果('mature_adult', 36, 'explicit', ['使用明确外貌描述'], {}, actualAge);
    }
    if (长寿种族.test(String(context.species ?? '')) && actualAge !== undefined && actualAge >= 45) {
        return 从分段构建结果('mature_adult', 36, 'species', ['长寿种族按自身生命周期判断'], {}, actualAge);
    }
    if ((group === 'xianxia' || group === 'urban_xianxia') && (meaningfulRealm || hasLongevityEvidence)) {
        return 从分段构建结果('mature_adult', 36, 'supernatural', ['长生题材与有效境界支持延寿'], {}, actualAge);
    }
    if (['infinite', 'western_fantasy', 'apocalypse', 'wuxia'].includes(group) && hasLongevityEvidence) {
        return 从分段构建结果('mature_adult', 36, 'supernatural', ['条件超凡题材存在角色级延寿证据'], {}, actualAge);
    }
    if (actualAge !== undefined) {
        return 从年龄构建结果(actualAge, 'realistic', ['没有超凡延寿证据，按现实年龄判断']);
    }
    return 从分段构建结果('unknown', undefined, 'unknown', ['年龄证据不足']);
};
```

Implement `从年龄构建结果` and `从分段构建结果` in the same file. They are pure helpers that map `0-12 -> child`, `13-14 -> early_teen`, `15-17 -> late_teen`, `18-27 -> young_adult`, `28-44 -> mature_adult`, `45-64 -> middle_aged`, and `65+ -> elderly`:

```ts
const 叙事约束映射: Record<VisualAgeBand, string[]> = {
    child: ['按未成年外观描写，禁止成人化'],
    early_teen: ['按未成年外观描写，禁止成人化'],
    late_teen: ['按未成年外观描写，禁止成人化'],
    young_adult: ['真实年龄只代表经历；外貌按青年成年人描写', '不得仅因真实年龄称为老妇、老妪或老太婆'],
    mature_adult: ['真实年龄只代表经历；外貌按成熟成年人描写', '不得仅因真实年龄称为老妇、老妪或老太婆'],
    middle_aged: ['外貌按中年成年人描写，不得擅自幼化或老年化'],
    elderly: ['档案支持老年外貌，可以使用与老态一致的外貌措辞'],
    unknown: ['年龄信息不足，不得擅自写成未成年人或老人']
};

const 正向标签映射: Record<VisualAgeBand, string[]> = {
    child: ['child appearance', 'age-appropriate child face'],
    early_teen: ['early teen appearance', 'age-appropriate teen face'],
    late_teen: ['late teen appearance', 'age-appropriate teen face'],
    young_adult: ['adult', 'young adult face', 'physically vigorous'],
    mature_adult: ['adult', 'mature youthful face', 'physically vigorous'],
    middle_aged: ['adult', 'middle-aged appearance'],
    elderly: ['elderly appearance', 'aged face'],
    unknown: ['adult']
};

const 负向标签映射: Record<VisualAgeBand, string[]> = {
    child: ['adult body', 'mature adult face', 'elderly appearance'],
    early_teen: ['child', 'adult body', 'elderly appearance'],
    late_teen: ['child', 'adult body', 'elderly appearance'],
    young_adult: ['child', 'teenage', 'elderly appearance', 'old face', 'wrinkles', 'frail body'],
    mature_adult: ['child', 'teenage', 'elderly appearance', 'old face', 'wrinkles', 'frail body'],
    middle_aged: ['child', 'teenage', 'elderly appearance'],
    elderly: ['child', 'teenage'],
    unknown: ['child', 'teenage']
};

const 从分段构建结果 = (
    visualAgeBand: VisualAgeBand,
    suggestedVisualAge: number | undefined,
    source: VisualAgeResolution['source'],
    reasons: string[],
    overrides: Partial<Pick<VisualAgeResolution, 'explicitYouthfulAppearance' | 'isAdultForPrivateImage'>> = {},
    actualAge?: number
): VisualAgeResolution => {
    const explicitYouthfulAppearance = overrides.explicitYouthfulAppearance === true;
    return {
        actualAge,
        visualAgeBand,
        suggestedVisualAge,
        source,
        reasons,
        positiveTags: 正向标签映射[visualAgeBand],
        negativeTags: 负向标签映射[visualAgeBand],
        narrativeConstraints: 叙事约束映射[visualAgeBand],
        explicitYouthfulAppearance,
        isAdultForPrivateImage: overrides.isAdultForPrivateImage
            ?? Boolean(actualAge !== undefined && actualAge >= 18 && !explicitYouthfulAppearance)
    };
};

const 从年龄构建结果 = (
    visualAge: number,
    source: VisualAgeResolution['source'],
    reasons: string[],
    actualAge = visualAge
): VisualAgeResolution => {
    const band: VisualAgeBand = visualAge <= 12 ? 'child'
        : visualAge <= 14 ? 'early_teen'
            : visualAge <= 17 ? 'late_teen'
                : visualAge <= 27 ? 'young_adult'
                    : visualAge <= 44 ? 'mature_adult'
                        : visualAge <= 64 ? 'middle_aged'
                            : 'elderly';
    return 从分段构建结果(band, visualAge, source, reasons, {}, actualAge);
};
```

Use explicit evidence groups rather than matching titles as age evidence:

```ts
const 明确老态 = /老妪|老妇|老太婆|老者面容|白发苍苍|皱纹(?:纵横|深重)|面容枯槁|寿元将尽|衰老诅咒|急速衰老/u;
const 明确幼态 = /幼童外貌|孩童外貌|稚嫩如孩童|外表(?:只有|如同)?(?:七|八|九|十|十一|十二)岁/u;
const 超凡维持 = /驻颜|返老还童|青春药剂|基因强化|血统强化|身体机能保持巅峰|不老|长生|寿命漫长/u;
const 长寿种族 = /精灵|血族|龙族|仙族|神族|长生种/u;
```

Do not include `长老`, `老祖`, `前辈`, `宗主`, or `掌门` in `明确老态`.

- [ ] **Step 4: Run the resolver tests and verify pass**

Run: `npm run test:run -- __tests__/visualAge.test.ts`

Expected: PASS for all resolver cases.

- [ ] **Step 5: Commit the resolver**

```bash
git add utils/visualAge.ts __tests__/visualAge.test.ts
git commit -m "feat: add unified visual age resolver"
```

### Task 2: Add Compatible Data Fields and Context Plumbing

**Files:**
- Modify: `models/character.ts`
- Modify: `models/social.ts`
- Modify: `models/system.ts`
- Modify: `utils/variableRegistry.ts`
- Modify: `hooks/useGame/npcContext.ts`
- Modify: `hooks/useGame/systemPromptBuilder.ts`
- Test: `__tests__/worldbookSystemPrompt.test.ts`

- [ ] **Step 1: Write failing context tests**

Add a test to `__tests__/worldbookSystemPrompt.test.ts` that builds an仙侠 prompt with 清霜:

```ts
it('injects real age separately from visual-age narrative constraints', () => {
    const systemPrompt = 构建系统提示词({
        promptPool: [],
        memoryData: 创建空记忆系统(),
        socialData: [{
            id: 'npc-qingshuang',
            姓名: '清霜',
            性别: '女',
            年龄: 85,
            境界: '金丹四层',
            境界层级: 16,
            身份: '玉仙宗巡查使、宗门长老',
            是否在场: true,
            是否主要角色: true,
            外貌描写: '身姿挺拔，动作敏捷，面容清冷'
        }],
        statePayload: { 环境: {}, 世界: {}, 角色: {} },
        gameConfig: {} as any,
        memoryConfig: {} as any,
        openingConfig: { 题材模式: '仙侠' } as any,
        worldEvolutionEnabled: false
    }).systemPrompt;

    expect(systemPrompt).toContain('真实年龄');
    expect(systemPrompt).toContain('85');
    expect(systemPrompt).toContain('视觉年龄约束');
    expect(systemPrompt).toContain('不得仅因真实年龄称为老妇、老妪或老太婆');
});
```

Add a second case with `外观年龄: '垂暮老者'` and assert the prompt permits old-age appearance wording.

- [ ] **Step 2: Run the context test and verify failure**

Run: `npm run test:run -- __tests__/worldbookSystemPrompt.test.ts`

Expected: FAIL because the current NPC context exposes `年龄` but no visual-age narrative constraint.

- [ ] **Step 3: Add optional schema fields without migrations**

Add these optional properties:

```ts
// models/character.ts, 角色数据结构
外观年龄?: number | string;

// models/social.ts, NPC结构
外观年龄?: number | string;
境界层级?: number;

// models/system.ts, 角色锚点结构
视觉年龄签名?: string;
```

Add `外观年龄` to the existing social/character variable field registry in `utils/variableRegistry.ts`. Do not assign defaults in normalization; object spreads must preserve old saves with no field and new saves with the field.

- [ ] **Step 4: Make image base data carry resolver inputs**

Extend `生图基础数据选项` in `hooks/useGame/npcContext.ts`:

```ts
type 生图基础数据选项 = {
    cultivationSystemEnabled?: boolean;
    openingConfig?: OpeningConfig | null;
};
```

Return these fields from both `提取NPC生图基础数据` and `提取主角生图基础数据` when present:

```ts
外观年龄: npc?.外观年龄,
境界层级: typeof npc?.境界层级 === 'number' ? npc.境界层级 : undefined,
种族: 读取首个文本字段(npc, ['种族', '血统']) || undefined,
状态: 读取首个文本字段(npc, ['状态', '身体状态']) || undefined,
题材模式: options?.openingConfig?.题材模式,
模式运行时: options?.openingConfig?.modeRuntimeProfile
```

Use the corresponding character fields in the player extractor.

- [ ] **Step 5: Add visual-age narrative data to NPC context**

Inside `构建NPC上下文`, call `解析视觉年龄` for each NPC with `options.openingConfig`. Replace the ambiguous age-only representation in full NPC data with explicit fields:

```ts
const visualAge = 解析视觉年龄({
    actualAge: typeof npc?.年龄 === 'number' ? npc.年龄 : undefined,
    explicitVisualAge: npc?.外观年龄,
    topicMode: options?.openingConfig?.题材模式,
    runtimeProfile: options?.openingConfig?.modeRuntimeProfile,
    realmName: npc?.境界,
    realmLevel: npc?.境界层级,
    species: 取首个非空文本(npc?.种族, npc?.血统),
    identity: npc?.身份,
    appearance: 取首个非空文本(npc?.外貌描写, npc?.外貌),
    profileText: npc?.简介,
    statusText: 取首个非空文本(npc?.状态, npc?.身体状态)
});

return 清理空字段({
    ...基础,
    真实年龄: visualAge.actualAge,
    明确外观年龄: npc?.外观年龄,
    视觉年龄约束: visualAge.narrativeConstraints.join('；'),
    // existing fields continue here
});
```

For non-main NPCs, include the compact `真实年龄` and `视觉年龄约束` in `基础数据` too; otherwise the story model can still mis-age secondary speakers.

- [ ] **Step 6: Preserve the player's explicit visual age in prompt serialization**

In the ordered role object in `hooks/useGame/systemPromptBuilder.ts`, add:

```ts
外观年龄: typeof role?.外观年龄 === 'number'
    ? role.外观年龄
    : 取文本(role?.外观年龄),
```

Do not replace `年龄`; both values have distinct meanings.

- [ ] **Step 7: Run context and resolver tests**

Run: `npm run test:run -- __tests__/visualAge.test.ts __tests__/worldbookSystemPrompt.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit schema and context plumbing**

```bash
git add models/character.ts models/social.ts models/system.ts utils/variableRegistry.ts hooks/useGame/npcContext.ts hooks/useGame/systemPromptBuilder.ts __tests__/worldbookSystemPrompt.test.ts
git commit -m "feat: expose visual age in character context"
```

### Task 3: Replace NPC Image Age Guessing with the Resolver

**Files:**
- Modify: `hooks/useGame/npcImageWorkflow.ts`
- Modify: `hooks/useGame/image/manualImageActionsWorkflow.ts`
- Modify: `hooks/useGame.ts`
- Modify: `__tests__/npcImageWorkflow.test.ts`
- Modify: `__tests__/manualImageActionsWorkflow.test.ts`

- [ ] **Step 1: Write failing final-prompt tests**

Extend the test dependency builder with a captured image-service call and current opening config. Test the final task inputs, not only `构建词组转化性别硬约束`:

```ts
it('never appends real age or age-accurate face for an immortal high-realm adult', async () => {
    const npc = {
        id: 'npc-qingshuang',
        姓名: '清霜',
        性别: '女',
        年龄: 85,
        境界: '金丹四层',
        境界层级: 16,
        身份: '玉仙宗巡查使',
        外貌: '身姿挺拔，动作敏捷，面容清冷'
    };
    const { deps, 创建NPC生图任务 } = 构建NPC生图依赖([npc]);
    deps.获取开局配置 = () => ({ 题材模式: '仙侠' });

    await 执行NPC生图工作流(npc, { force: true, 构图: '头像' }, deps as any);

    const task = 创建NPC生图任务.mock.calls[0][0];
    expect(task.画师串).not.toContain('85 years old');
    expect(task.画师串).not.toContain('age-accurate face');
    expect(task.画师串).toContain('mature youthful face');
});
```

Add a realistic 85-year-old case and an explicit old-looking cultivator case. Their final positive prompt must contain `elderly appearance`, and their negative prompt must not ban wrinkles.

- [ ] **Step 2: Run the NPC workflow test and verify failure**

Run: `npm run test:run -- __tests__/npcImageWorkflow.test.ts`

Expected: FAIL because `构建年龄正向提示词` still emits the real age plus `age-accurate face`.

- [ ] **Step 3: Add opening config to workflow dependencies**

In `NPC生图工作流依赖`, add:

```ts
获取开局配置?: () => OpeningConfig | null | undefined;
```

In `hooks/useGame.ts`, provide:

```ts
获取开局配置: () => 最近开局配置,
```

Also pass `openingConfig: 最近开局配置` when calling `提取NPC生图基础数据附带私密描述`.

- [ ] **Step 4: Resolve visual age exactly once per image request**

Immediately after `目标年龄` is read, create one result:

```ts
const openingConfig = deps.获取开局配置?.();
const 视觉年龄 = 解析视觉年龄({
    actualAge: 目标年龄,
    explicitVisualAge: npcImageBaseData?.外观年龄 ?? npc?.外观年龄,
    topicMode: openingConfig?.题材模式 ?? npcImageBaseData?.题材模式,
    runtimeProfile: openingConfig?.modeRuntimeProfile ?? npcImageBaseData?.模式运行时,
    realmName: npcImageBaseData?.境界 ?? npc?.境界,
    realmLevel: npcImageBaseData?.境界层级 ?? npc?.境界层级,
    species: npcImageBaseData?.种族 ?? npc?.种族 ?? npc?.血统,
    identity: npcImageBaseData?.身份 ?? npc?.身份,
    appearance: npcImageBaseData?.外貌 ?? npc?.外貌描写 ?? npc?.外貌,
    profileText: npcImageBaseData?.简介 ?? npc?.简介,
    statusText: npcImageBaseData?.状态 ?? npc?.状态 ?? npc?.身体状态
});
```

Delete `存在修炼长生语境`. Refactor `构建年龄正向提示词`, `构建男娘年龄正向提示词`, `构建扶她年龄正向提示词`, `构建年龄负向提示词`, `构建性别正向提示词`, `强制性别词组`, and `构建词组转化性别硬约束` to accept `VisualAgeResolution` instead of a raw age.

- [ ] **Step 5: Use one result in every prompt stage**

Use the same `视觉年龄` for:

```ts
const 性别正向提示词 = 构建性别正向提示词(目标性别, 视觉年龄);
const 年龄负向提示词 = 视觉年龄.negativeTags.join(', ');
const 词组转化性别硬约束 = 构建词组转化性别硬约束(目标性别, 视觉年龄, npcImageBaseData);
```

When the transformed prompt returns, call:

```ts
const 生图词组 = 强制性别词组(原始生图词组, 目标性别, 视觉年龄);
```

The hard constraint must describe both facts without contradiction:

```text
真实年龄是 85 岁，用于经历和资历；视觉年龄按成熟成年人处理。最终 tags 禁止写入 85 years old、elderly、old face、wrinkles 或 frail body。
```

For realistic or explicitly old results, use the resolved visual tags and do not append a negative ban on old age.

- [ ] **Step 6: Add resolver safety to NPC private-image task collection**

Add `获取开局配置?: () => OpeningConfig | null | undefined` to `手动图片动作工作流依赖` in `hooks/useGame/image/manualImageActionsWorkflow.ts`. Resolve the NPC before `NPC是否允许私密部位生图` returns true:

```ts
const NPC满足私密生图年龄安全 = (npc: any, openingConfig?: OpeningConfig | null): boolean => 解析视觉年龄({
    actualAge: npc?.年龄,
    explicitVisualAge: npc?.外观年龄,
    topicMode: openingConfig?.题材模式,
    runtimeProfile: openingConfig?.modeRuntimeProfile,
    realmName: npc?.境界,
    realmLevel: npc?.境界层级,
    species: npc?.种族 ?? npc?.血统,
    identity: npc?.身份,
    appearance: npc?.外貌描写 ?? npc?.外貌,
    profileText: npc?.简介,
    statusText: npc?.状态 ?? npc?.身体状态
}).isAdultForPrivateImage;
```

Use this predicate both for the target NPC and every automatically collected major NPC. When false, show `角色真实年龄或明确视觉年龄不满足成人私密生图要求。` and do not call `执行NPC香闺秘档部位生图`. Preserve all existing NSFW, gender, part-description, and feature-toggle checks.

Add tests to `__tests__/manualImageActionsWorkflow.test.ts` for a 16-year-old high-realm NPC and a 200-year-old NPC with `外观年龄: '幼童外貌'`; both must produce zero generation calls.

- [ ] **Step 7: Run NPC image tests**

Run: `npm run test:run -- __tests__/visualAge.test.ts __tests__/npcImageWorkflow.test.ts __tests__/manualImageActionsWorkflow.test.ts __tests__/npcSecretPartPendingPreservation.test.ts __tests__/nsfwImageGeneration.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit NPC image integration**

```bash
git add hooks/useGame/npcImageWorkflow.ts hooks/useGame/image/manualImageActionsWorkflow.ts hooks/useGame.ts __tests__/npcImageWorkflow.test.ts __tests__/manualImageActionsWorkflow.test.ts
git commit -m "fix: apply visual age to npc image prompts"
```

### Task 4: Apply the Same Rules to Player Images

**Files:**
- Modify: `hooks/useGame/playerImageWorkflow.ts`
- Modify: `hooks/useGame.ts`
- Modify: `__tests__/playerImageWorkflow.test.ts`

- [ ] **Step 1: Write a failing player propagation test**

Add to `__tests__/playerImageWorkflow.test.ts`:

```ts
it('passes the current topic and explicit visual age into the shared image workflow', async () => {
    const 执行生图 = vi.fn(async () => undefined);
    const deps = 创建依赖(执行生图);
    deps.获取开局配置 = () => ({ 题材模式: '仙侠' });
    deps.获取角色 = () => ({
        姓名: '霁月',
        性别: '女',
        年龄: 120,
        外观年龄: 30,
        境界: '元婴一层',
        境界层级: 17,
        外貌: '青年女子外貌'
    });

    const workflow = 创建主角图片工作流(deps as any);
    await workflow.generatePlayerImageManually({ 构图: '头像' });

    expect(执行生图).toHaveBeenCalledWith(
        expect.objectContaining({ 年龄: 120, 外观年龄: 30, 境界层级: 17 }),
        expect.any(Object),
        expect.objectContaining({ 获取开局配置: expect.any(Function) })
    );
});
```

- [ ] **Step 2: Run the player test and verify failure**

Run: `npm run test:run -- __tests__/playerImageWorkflow.test.ts`

Expected: FAIL because the dependency and synthesized player NPC do not carry the new fields/config.

- [ ] **Step 3: Add opening config to player workflow dependencies**

Add to `主角图片工作流依赖`:

```ts
获取开局配置?: () => OpeningConfig | null | undefined;
```

In `hooks/useGame.ts`, provide `获取开局配置: () => 最近开局配置` and pass it through the nested `执行NPC生图工作流` dependency object.

- [ ] **Step 4: Preserve all resolver inputs on the synthesized player NPC**

Extend the object around the current player-to-NPC adaptation:

```ts
{
    id: 主角角色锚点标识,
    姓名: playerSnapshot?.姓名,
    性别: playerSnapshot?.性别,
    年龄: playerSnapshot?.年龄,
    外观年龄: playerSnapshot?.外观年龄,
    境界: playerSnapshot?.境界,
    境界层级: playerSnapshot?.境界层级,
    种族: (playerSnapshot as any)?.种族,
    血统: (playerSnapshot as any)?.血统,
    外貌: playerSnapshot?.外貌,
    状态: (playerSnapshot as any)?.状态
}
```

- [ ] **Step 5: Block unsafe player private-image requests**

At the start of `generatePlayerSecretPartImage`, resolve the current player with `deps.获取开局配置?.()`. Before loading or calling the private image workflow, enforce:

```ts
const visualAge = 解析视觉年龄({
    actualAge: player?.年龄,
    explicitVisualAge: player?.外观年龄,
    topicMode: openingConfig?.题材模式,
    runtimeProfile: openingConfig?.modeRuntimeProfile,
    realmName: player?.境界,
    realmLevel: player?.境界层级,
    species: (player as any)?.种族 ?? (player as any)?.血统,
    identity: [player?.称号, player?.出身背景?.名称].filter(Boolean).join(' / '),
    appearance: player?.外貌,
    profileText: player?.出身背景?.描述,
    statusText: (player as any)?.状态 ?? (player as any)?.身体状态
});
if (!visualAge.isAdultForPrivateImage) {
    deps.推送右下角提示({
        title: '私密特写不可用',
        message: '角色真实年龄或明确视觉年龄不满足成人私密生图要求。',
        tone: 'error'
    });
    return;
}
```

Add two tests to `__tests__/playerImageWorkflow.test.ts`: a 16-year-old high-realm player and a 200-year-old player with `外观年龄: '幼童外貌'`. Assert `加载NPC生图工作流` is not called.

- [ ] **Step 6: Run player and NPC workflow tests**

Run: `npm run test:run -- __tests__/playerImageWorkflow.test.ts __tests__/npcImageWorkflow.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit player integration**

```bash
git add hooks/useGame/playerImageWorkflow.ts hooks/useGame.ts __tests__/playerImageWorkflow.test.ts
git commit -m "fix: share visual age rules with player images"
```

### Task 5: Refresh Only Stale Automatic Character Anchors

**Files:**
- Modify: `utils/visualAge.ts`
- Modify: `models/system.ts`
- Modify: `utils/apiConfig.ts`
- Modify: `hooks/useGame/imagePresetWorkflow.ts`
- Modify: `hooks/useGame/npcImageWorkflow.ts`
- Modify: `hooks/useGame/playerImageWorkflow.ts`
- Modify: `hooks/useGame.ts`
- Test: `__tests__/visualAge.test.ts`
- Test: `__tests__/npcImageWorkflow.test.ts`
- Test: `__tests__/playerImageWorkflow.test.ts`
- Test: `__tests__/apiConfigImagePresets.test.ts`

- [ ] **Step 1: Write failing visual signature tests**

Add to `__tests__/visualAge.test.ts`:

```ts
import { 构建视觉年龄签名, 自动角色锚点视觉年龄是否过期 } from '../utils/visualAge';

it('marks an automatic elderly anchor stale when the current result is mature adult', () => {
    const current = 解析视觉年龄({ actualAge: 85, topicMode: '仙侠', realmLevel: 16 });
    const anchor = {
        来源: 'ai_extract',
        视觉年龄签名: 'v1:elderly:85',
        正面提示词: 'elderly woman, wrinkles',
        负面提示词: ''
    } as any;

    expect(自动角色锚点视觉年龄是否过期(anchor, current)).toBe(true);
});

it('never marks a manual anchor stale automatically', () => {
    const current = 解析视觉年龄({ actualAge: 85, topicMode: '仙侠', realmLevel: 16 });
    expect(自动角色锚点视觉年龄是否过期({
        来源: 'manual',
        正面提示词: 'elderly woman, wrinkles'
    } as any, current)).toBe(false);
});
```

- [ ] **Step 2: Run signature tests and verify failure**

Run: `npm run test:run -- __tests__/visualAge.test.ts`

Expected: FAIL because signature helpers are missing.

- [ ] **Step 3: Implement stable visual-age signatures**

Add to `utils/visualAge.ts`:

```ts
export const 构建视觉年龄签名 = (result: VisualAgeResolution): string => [
    'v1',
    result.visualAgeBand,
    result.suggestedVisualAge ?? '',
    result.explicitYouthfulAppearance ? 'youthful' : 'normal'
].join(':');

export const 自动角色锚点视觉年龄是否过期 = (
    anchor: Pick<角色锚点结构, '来源' | '视觉年龄签名' | '正面提示词' | '负面提示词'> | null | undefined,
    current: VisualAgeResolution
): boolean => {
    if (!anchor || anchor.来源 !== 'ai_extract') return false;
    if (anchor.视觉年龄签名) return anchor.视觉年龄签名 !== 构建视觉年龄签名(current);
    const text = `${anchor.正面提示词 || ''} ${anchor.负面提示词 || ''}`.toLowerCase();
    const hasOldTags = /elderly|old face|wrinkles|frail body/.test(text);
    const hasMinorTags = /\bchild\b|\bteenage\b|\bearly teen\b|\blate teen\b/.test(text);
    const exactAge = text.match(/\b(\d{1,4})\s*years? old\b/)?.[1];
    if (current.visualAgeBand === 'elderly') return hasMinorTags;
    if (['child', 'early_teen', 'late_teen'].includes(current.visualAgeBand)) return hasOldTags || Boolean(exactAge && Number(exactAge) >= 18);
    if (hasOldTags || hasMinorTags) return true;
    return Boolean(exactAge && current.suggestedVisualAge !== undefined && Number(exactAge) !== current.suggestedVisualAge);
};
```

For legacy automatic anchors without a signature, detect only clear conflicts such as `elderly`, `old face`, `wrinkles`, `child`, `teenage`, or exact `N years old`. Do not invalidate on vague words such as `mature`, `beautiful`, or `young-looking` alone.

- [ ] **Step 4: Preserve the optional field in API config normalization**

In `utils/apiConfig.ts`, copy a trimmed `视觉年龄签名` when normalizing anchor objects:

```ts
视觉年龄签名: 读取字符串(source?.视觉年龄签名 ?? source?.visualAgeSignature).trim() || undefined,
```

Add a round-trip assertion in `__tests__/apiConfigImagePresets.test.ts`.

- [ ] **Step 5: Store signatures on AI-extracted anchors**

In both NPC and player extraction paths in `hooks/useGame/imagePresetWorkflow.ts`, resolve visual age from `baseData` and save:

```ts
视觉年龄签名: 构建视觉年龄签名(解析视觉年龄({
    actualAge: baseData?.年龄,
    explicitVisualAge: baseData?.外观年龄,
    topicMode: baseData?.题材模式,
    runtimeProfile: baseData?.模式运行时,
    realmName: baseData?.境界,
    realmLevel: baseData?.境界层级,
    species: baseData?.种族 ?? baseData?.血统,
    identity: baseData?.身份,
    appearance: baseData?.外貌,
    profileText: baseData?.简介,
    statusText: baseData?.状态
})),
```

Do not assign or overwrite this field when `来源 === 'manual'`.

- [ ] **Step 6: Refresh stale automatic anchors before generation**

Change `确保NPC生图前角色锚点` in `hooks/useGame.ts` so an existing anchor only suppresses extraction when it is not stale:

```ts
const existing = 按NPC读取角色锚点(npcId);
const visualAge = 解析视觉年龄({
    actualAge: npc?.年龄,
    explicitVisualAge: npc?.外观年龄,
    topicMode: 最近开局配置?.题材模式,
    runtimeProfile: 最近开局配置?.modeRuntimeProfile,
    realmName: npc?.境界,
    realmLevel: npc?.境界层级,
    species: npc?.种族 ?? npc?.血统,
    identity: npc?.身份,
    appearance: npc?.外貌描写 ?? npc?.外貌,
    profileText: npc?.简介,
    statusText: npc?.状态 ?? npc?.身体状态
});
if (existing && !自动角色锚点视觉年龄是否过期(existing, visualAge)) return;
if (existing?.来源 !== 'ai_extract') return;
```

Apply the same rule in `主角锚点是否匹配当前角色`: manual/imported anchors remain usable; an `ai_extract` anchor with a conflicting signature triggers `提取主角角色锚点` before generation.

- [ ] **Step 7: Filter a stale legacy automatic anchor during the current request**

If automatic re-extraction fails or times out, do not inject the known-conflicting legacy anchor into the current image prompt. In `npcImageWorkflow.ts` and `playerImageWorkflow.ts`, return `null` for that automatic anchor while keeping the saved anchor intact for later retry.

- [ ] **Step 8: Run anchor and image workflow tests**

Run: `npm run test:run -- __tests__/visualAge.test.ts __tests__/apiConfigImagePresets.test.ts __tests__/npcImageWorkflow.test.ts __tests__/playerImageWorkflow.test.ts`

Expected: PASS, including explicit assertions that manual anchors are never rewritten or dropped solely for visual-age disagreement.

- [ ] **Step 9: Commit automatic anchor invalidation**

```bash
git add utils/visualAge.ts models/system.ts utils/apiConfig.ts hooks/useGame/imagePresetWorkflow.ts hooks/useGame/npcImageWorkflow.ts hooks/useGame/playerImageWorkflow.ts hooks/useGame.ts __tests__/visualAge.test.ts __tests__/apiConfigImagePresets.test.ts __tests__/npcImageWorkflow.test.ts __tests__/playerImageWorkflow.test.ts
git commit -m "fix: refresh stale automatic age anchors"
```

### Task 6: Final Narrative, Safety, and Regression Verification

**Files:**
- Verify: `hooks/useGame/npcContext.ts`
- Verify: `hooks/useGame/npcImageWorkflow.ts`
- Verify: `hooks/useGame/playerImageWorkflow.ts`
- Modify: `__tests__/visualAge.test.ts`
- Modify: `__tests__/npcImageWorkflow.test.ts`
- Modify: `__tests__/playerImageWorkflow.test.ts`
- Modify: `__tests__/worldbookSystemPrompt.test.ts`

- [ ] **Step 1: Add the complete regression matrix**

Ensure tests explicitly cover:

```text
仙侠：85 岁金丹，无老态 -> mature_adult，禁止老妇称呼和老年图像标签
仙侠：85 岁金丹，寿元将尽 -> elderly，允许老态
现实：85 岁普通人 -> elderly
无限流：85 岁未强化普通人 -> elderly
无限流：85 岁强化轮回者 -> mature_adult
西幻：高龄普通人 -> realistic；高龄精灵 -> species/supernatural
身份：长老/老祖但无老态 -> 不触发 elderly
未成年：16 岁高境界 -> late_teen，禁止成人私密生图
成年幼态：200 岁幼童外貌 -> 禁止成人私密生图
锚点：旧自动 elderly 锚点 -> 失效；手动 elderly 锚点 -> 保留
主角与 NPC：相同输入 -> 相同视觉年龄标签
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
npm run test:run -- __tests__/visualAge.test.ts __tests__/npcImageWorkflow.test.ts __tests__/playerImageWorkflow.test.ts __tests__/manualImageActionsWorkflow.test.ts __tests__/worldbookSystemPrompt.test.ts __tests__/apiConfigImagePresets.test.ts __tests__/npcSecretPartPendingPreservation.test.ts __tests__/nsfwImageGeneration.test.ts
```

Expected: PASS with no unhandled promise rejections.

- [ ] **Step 3: Run the full unit suite**

Run: `npm run test:run`

Expected: all Vitest suites PASS.

- [ ] **Step 4: Run TypeScript production build**

Run: `npm run build`

Expected: release metadata sync and Vite production build both succeed with no TypeScript errors.

- [ ] **Step 5: Inspect generated prompt evidence**

Run the focused 清霜 workflow test with verbose output or a temporary test-only assertion and confirm the effective prompt contains:

```text
adult woman
mature youthful face
physically vigorous
```

It must not contain:

```text
85 years old
age-accurate face
elderly woman
old face
wrinkles
frail body
```

Remove any temporary logging before commit.

- [ ] **Step 6: Review the final diff for scope and save compatibility**

Run:

```bash
git diff --check
git status --short
git diff --stat HEAD~5..HEAD
```

Expected: no whitespace errors; no generated files, APKs, logs, screenshots, `.reasonix/`, or unrelated release files are staged.

- [ ] **Step 7: Commit final regression adjustments if needed**

If Step 2-6 required source or test corrections, stage the complete known visual-age surface explicitly:

```bash
git add utils/visualAge.ts models/character.ts models/social.ts models/system.ts utils/variableRegistry.ts utils/apiConfig.ts hooks/useGame/npcContext.ts hooks/useGame/npcImageWorkflow.ts hooks/useGame/playerImageWorkflow.ts hooks/useGame/imagePresetWorkflow.ts hooks/useGame/image/manualImageActionsWorkflow.ts hooks/useGame/systemPromptBuilder.ts hooks/useGame.ts __tests__/visualAge.test.ts __tests__/npcImageWorkflow.test.ts __tests__/playerImageWorkflow.test.ts __tests__/manualImageActionsWorkflow.test.ts __tests__/worldbookSystemPrompt.test.ts __tests__/apiConfigImagePresets.test.ts
git commit -m "test: cover visual age regressions"
```

If no corrections were needed, do not create an empty commit.

## Completion Checklist

- [ ] 清霜的真实年龄仍为 85，视觉提示词不含现实老年硬约束。
- [ ] 明确老态、寿元枯竭和衰老诅咒优先于高境界。
- [ ] 无限流和西幻按角色证据判断，不全员年轻化。
- [ ] 完全现实人物继续按现实年龄衰老。
- [ ] 主角、NPC、剧情上下文和自动锚点消费同一个解析器结果。
- [ ] 未成年人和成年幼态角色不能进入成人私密生图。
- [ ] 手动锚点未被自动覆盖，旧自动冲突锚点可安全失效。
- [ ] 旧存档无需迁移，旧图片未自动删除。
- [ ] Focused tests、full Vitest 和 `npm run build` 全部通过。
- [ ] 未部署；只有用户明确要求“部署/发布/上线”后才进入版本升级与发布流程。
