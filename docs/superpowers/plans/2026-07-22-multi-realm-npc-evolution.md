# Multi-Realm DIY and NPC Evolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add primary/secondary ability systems with shared power-level conversion to DIY realms, and safely persist successful off-screen NPC realm/equipment settlements into existing NPC records.

**Architecture:** Extend the existing realm draft and character/NPC types without removing legacy `境界/境界层级`. Keep migration, prompt generation, and effective-power calculation in focused utilities. Add a pure NPC settlement bridge that validates world-evolution results and returns a whitelist of minimal `社交[i]` commands, then integrate it after world commands are normalized.

**Tech Stack:** TypeScript 5.8, React 19, Vitest 3, Vite 6, existing command processor and world-evolution workflow.

---

### Task 1: Multi-system realm types and legacy migration

**Files:**
- Modify: `models/system.ts`
- Modify: `utils/newGameDiy.ts`
- Create: `__tests__/multiRealmDiy.test.ts`

- [ ] **Step 1: Write failing migration and normalization tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildRealmPromptFromDraft, normalizeRealmDraft } from '../utils/newGameDiy';

describe('multi-system realm DIY', () => {
    it('migrates legacy rows into one primary-capable default system', () => {
        const draft = normalizeRealmDraft({
            rows: [{ id: 'r1', name: '锻体境', level: 1, power: '', breakthrough: '', parameters: '', description: '' }]
        });
        expect(draft.systems).toHaveLength(1);
        expect(draft.systems?.[0]).toMatchObject({ name: '默认体系', role: 'primary_or_secondary' });
        expect(draft.systems?.[0].rows[0].name).toBe('锻体境');
    });

    it('normalizes independent rows for every system', () => {
        const draft = normalizeRealmDraft({
            systems: [
                { id: 'martial', name: '武者', description: '体魄近战', energyType: '气血', role: 'primary_or_secondary', rows: [{ id: 'm1', name: '锻骨', level: 3, power: '', breakthrough: '', parameters: '', description: '' }] },
                { id: 'dao', name: '道士', description: '符箓术法', energyType: '法力', role: 'primary_or_secondary', rows: [{ id: 'd1', name: '炼气', level: 3, power: '', breakthrough: '', parameters: '', description: '' }] }
            ]
        });
        expect(draft.systems?.map((system) => system.name)).toEqual(['武者', '道士']);
        expect(draft.systems?.[0].rows[0].name).toBe('锻骨');
        expect(draft.systems?.[1].rows[0].name).toBe('炼气');
    });
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `npm run test:run -- __tests__/multiRealmDiy.test.ts`

Expected: TypeScript/runtime failure because `RealmDiyDraft.systems` and multi-system normalization do not exist.

- [ ] **Step 3: Add compatible realm-system types**

```ts
export type RealmDiySystemRole = 'primary_or_secondary' | 'primary_only' | 'secondary_only';

export interface RealmDiySystem {
    id: string;
    name: string;
    description: string;
    energyType: string;
    role: RealmDiySystemRole;
    rows: RealmDiyRow[];
}

export interface RealmDiyDraft {
    systems?: RealmDiySystem[];
    rows?: RealmDiyRow[];
    updatedAt?: number;
}
```

- [ ] **Step 4: Implement legacy migration and per-system normalization**

Add `normalizeRealmSystem(...)`, make `normalizeRealmDraft(...)` prefer non-empty `systems`, migrate legacy `rows` into `默认体系`, and retain a mirrored legacy `rows` value from the selected compatibility system for existing consumers.

```ts
const normalizedSystems = sourceSystems.length > 0
    ? sourceSystems.map(normalizeRealmSystem)
    : [{
        id: createDiyId('realm_system_default'),
        name: '默认体系',
        description: '',
        energyType: '',
        role: 'primary_or_secondary' as const,
        rows: legacyRows
    }];

return {
    systems: normalizedSystems,
    rows: normalizedSystems[0].rows,
    updatedAt: Date.now()
};
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npm run test:run -- __tests__/multiRealmDiy.test.ts __tests__/realmSystem.test.ts`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```powershell
git add models/system.ts utils/newGameDiy.ts __tests__/multiRealmDiy.test.ts
git commit -m "feat: add multi-system realm drafts"
```

### Task 2: Ability progress and effective power calculation

**Files:**
- Modify: `models/character.ts`
- Modify: `models/social.ts`
- Create: `utils/abilitySystems.ts`
- Modify: `__tests__/multiRealmDiy.test.ts`

- [ ] **Step 1: Write failing effective-power tests**

```ts
import { calculateEffectivePowerLevel, normalizeAbilitySystems } from '../utils/abilitySystems';

it('uses bounded secondary-system synergy instead of adding all levels', () => {
    expect(calculateEffectivePowerLevel({ powerLevel: 6 }, [])).toBe(6);
    expect(calculateEffectivePowerLevel({ powerLevel: 6 }, [{ powerLevel: 2 }])).toBe(6);
    expect(calculateEffectivePowerLevel({ powerLevel: 6 }, [{ powerLevel: 4 }])).toBe(7);
    expect(calculateEffectivePowerLevel({ powerLevel: 6 }, [{ powerLevel: 6 }, { powerLevel: 8 }])).toBe(8);
});

it('adapts legacy realm fields as a single primary system', () => {
    expect(normalizeAbilitySystems({ 境界: '锻骨境', 境界层级: 3 })).toMatchObject({
        primary: { systemName: '默认体系', realmName: '锻骨境', powerLevel: 3 },
        secondary: []
    });
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test:run -- __tests__/multiRealmDiy.test.ts`

Expected: import failure because `utils/abilitySystems.ts` does not exist.

- [ ] **Step 3: Add shared ability-system types**

```ts
export interface AbilitySystemProgress {
    systemId?: string;
    systemName: string;
    realmName: string;
    systemLevel: number;
    powerLevel: number;
}

export interface CharacterAbilitySystems {
    primary: AbilitySystemProgress;
    secondary: AbilitySystemProgress[];
}
```

Add optional `能力体系?: CharacterAbilitySystems` to player and NPC structures while keeping legacy fields unchanged.

- [ ] **Step 4: Implement pure normalization and calculation utilities**

```ts
export const calculateEffectivePowerLevel = (primary, secondary, maxLevel = 43) => {
    const primaryLevel = Math.max(1, Math.round(Number(primary?.powerLevel) || 1));
    const strongestSecondary = Math.max(0, ...secondary.map((item) => Math.round(Number(item?.powerLevel) || 0)));
    const gap = primaryLevel - strongestSecondary;
    const bonus = strongestSecondary <= 0 || gap >= 4 ? 0 : gap >= 1 ? 1 : 2;
    return Math.min(maxLevel, primaryLevel + bonus);
};
```

`normalizeAbilitySystems` must sanitize arrays and synthesize a legacy primary system when structured data is absent.

- [ ] **Step 5: Verify GREEN**

Run: `npm run test:run -- __tests__/multiRealmDiy.test.ts __tests__/npcStateTransforms.test.ts`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```powershell
git add models/character.ts models/social.ts utils/abilitySystems.ts __tests__/multiRealmDiy.test.ts
git commit -m "feat: model primary and secondary ability systems"
```

### Task 3: Multi-system prompt generation

**Files:**
- Modify: `utils/newGameDiy.ts`
- Modify: `prompts/core/realm.ts`
- Modify: `prompts/runtime/fandom.ts`
- Modify: `__tests__/multiRealmDiy.test.ts`
- Modify: `__tests__/realmSystem.test.ts`

- [ ] **Step 1: Write failing prompt tests**

```ts
it('emits separate system mappings plus one compatibility mapping', () => {
    const prompt = buildRealmPromptFromDraft({
        systems: [
            { id: 'martial', name: '武者', description: '近战', energyType: '气血', role: 'primary_or_secondary', rows: [{ id: 'm', name: '武者第二境', level: 3, power: '近战', breakthrough: '', parameters: '', description: '' }] },
            { id: 'dao', name: '道士', description: '术法', energyType: '法力', role: 'primary_or_secondary', rows: [{ id: 'd', name: '道士第一境', level: 3, power: '术法', breakthrough: '', parameters: '', description: '' }] }
        ]
    });
    expect(prompt).toContain('【能力体系：武者】');
    expect(prompt).toContain('【能力体系：道士】');
    expect(prompt).toContain('3 => 武者第二境');
    expect(prompt).toContain('3 => 道士第一境');
    expect(prompt).toContain('同档不等于能力相同');
    expect(prompt.match(/【境界映射母板】/g)).toHaveLength(1);
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test:run -- __tests__/multiRealmDiy.test.ts`

Expected: prompt lacks independent system sections.

- [ ] **Step 3: Refactor prompt generation around selected compatibility system**

Create small helpers inside `utils/newGameDiy.ts`:

```ts
const selectCompatibilitySystem = (systems: RealmDiySystem[]) =>
    systems.find((system) => system.role !== 'secondary_only') || systems[0];

const buildSystemSection = (system: RealmDiySystem) => [
    `【能力体系：${system.name}】`,
    `- 能量类型：${system.energyType || '按世界观定义'}`,
    `- 体系定位：${system.description || '按境界能力边界执行'}`,
    ...buildMappingLines(system.rows)
].join('\n');
```

Emit the legacy `【境界映射母板】` only for the compatibility system, followed by all independent system sections and explicit primary/secondary rules.

- [ ] **Step 4: Update core realm constraints**

Add prompt rules stating that `境界层级` is the shared effective level, `能力体系.primary/secondary` stores the source paths, equal shared levels have comparable pressure rather than identical capabilities, and secondary paths grant bounded synergy.

- [ ] **Step 5: Verify GREEN and regressions**

Run: `npm run test:run -- __tests__/multiRealmDiy.test.ts __tests__/realmSystem.test.ts __tests__/newGameTopicRealmPriority.test.ts`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```powershell
git add utils/newGameDiy.ts prompts/core/realm.ts prompts/runtime/fandom.ts __tests__/multiRealmDiy.test.ts __tests__/realmSystem.test.ts
git commit -m "feat: generate multi-system realm prompts"
```

### Task 4: DIY editor support for multiple systems

**Files:**
- Modify: `components/features/NewGame/NewGameDiyTools.tsx`
- Modify: `components/features/NewGame/mobile/MobileNewGameWizard.tsx`
- Modify: `components/features/NewGame/NewGameWizard.tsx`
- Create: `__tests__/newGameDiyMultiSystemUi.test.tsx`

- [ ] **Step 1: Write failing component behavior tests**

Test the extracted/exported state helpers rather than brittle pixel structure:

```ts
import { addRealmSystem, removeRealmSystem, updateRealmSystem } from '../components/features/NewGame/NewGameDiyTools';

it('adds and edits a second realm system without changing the first rows', () => {
    const initial = normalizeRealmDraft({ rows: [realmRow('锻骨', 3)] });
    const added = addRealmSystem(initial, '道士');
    const edited = updateRealmSystem(added, added.systems![1].id, { energyType: '法力' });
    expect(edited.systems?.[0].rows[0].name).toBe('锻骨');
    expect(edited.systems?.[1]).toMatchObject({ name: '道士', energyType: '法力' });
});

it('does not remove the final remaining realm system', () => {
    const initial = normalizeRealmDraft({ rows: [realmRow('锻骨', 3)] });
    expect(removeRealmSystem(initial, initial.systems![0].id).systems).toHaveLength(1);
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test:run -- __tests__/newGameDiyMultiSystemUi.test.tsx`

Expected: helper exports do not exist.

- [ ] **Step 3: Add immutable editor helpers**

Implement and export `addRealmSystem`, `removeRealmSystem`, and `updateRealmSystem`. Each returns a normalized draft, preserves unrelated systems, and keeps at least one system.

- [ ] **Step 4: Update the desktop DIY realm editor**

Add a compact system selector above the existing realm rows. The selected system exposes name, energy type, role, description, add/delete actions, and its own row editor. Existing `updateRealmRows` becomes system-scoped.

Use stable classes with day-theme overrides already used by this screen; avoid new near-black loading or placeholder panels.

- [ ] **Step 5: Ensure both desktop and mobile wizards persist the new draft**

Keep `realmDiyDraft` serialization unchanged at the wizard boundary because the new `systems` field is part of the same object. Confirm imports/exports and custom preset restoration call `normalizeRealmDraft`.

- [ ] **Step 6: Verify GREEN and build**

Run: `npm run test:run -- __tests__/newGameDiyMultiSystemUi.test.tsx __tests__/workshopOpeningRestore.test.ts`

Run: `npm run build`

Expected: tests and build pass.

- [ ] **Step 7: Commit**

```powershell
git add components/features/NewGame/NewGameDiyTools.tsx components/features/NewGame/NewGameWizard.tsx components/features/NewGame/mobile/MobileNewGameWizard.tsx __tests__/newGameDiyMultiSystemUi.test.tsx
git commit -m "feat: edit multiple DIY realm systems"
```

### Task 5: World-evolution settlement types and prompt contract

**Files:**
- Modify: `models/world.ts`
- Modify: `prompts/runtime/worldDataSchema.ts`
- Modify: `prompts/runtime/worldEvolution.ts`
- Modify: `prompts/runtime/worldEvolutionCot.ts`
- Modify: `hooks/useGame/systemPromptBuilder.ts`
- Create: `__tests__/npcEvolutionSettlement.test.ts`

- [ ] **Step 1: Write failing schema/context tests**

```ts
it('includes npc id and structured settlement in world context', () => {
    const text = buildWorldStateTextForTest({
        活跃NPC列表: [{
            npcId: 'npc-1', 姓名: '沈青萝', 所属势力: '青云门', 当前位置: '后山', 当前状态: '闭关',
            当前行动: '冲击筑基', 行动开始时间: '1:01:01:00:00', 行动结束时间: '1:01:02:00:00',
            settlement: { status: 'pending', reason: '闭关尚未结束' }
        }]
    });
    expect(text).toContain('npcId');
    expect(text).toContain('settlement');
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test:run -- __tests__/npcEvolutionSettlement.test.ts`

Expected: missing settlement fields or test helper.

- [ ] **Step 3: Add active-NPC settlement types**

Add `NPC后台结算结构`, realm/equipment change types, optional `npcId`, and optional `settlement` to `活跃NPC结构`.

- [ ] **Step 4: Extend schema and evolution prompts**

Require models to keep `pending` until the action is truly resolved; only write `success` with explicit reason and complete change objects. State that profession, identity, elapsed time, or intended purchases are insufficient evidence. Require specific sources and slots for equipment.

- [ ] **Step 5: Include structured fields in world context**

Extend the existing `活跃NPC列表` projection in `systemPromptBuilder.ts` with sanitized `npcId` and `settlement`, without adding the entire `社交[]` object to the world prompt.

- [ ] **Step 6: Verify GREEN**

Run: `npm run test:run -- __tests__/npcEvolutionSettlement.test.ts __tests__/worldEvolutionEvents.test.ts`

Expected: all tests pass.

- [ ] **Step 7: Commit**

```powershell
git add models/world.ts prompts/runtime/worldDataSchema.ts prompts/runtime/worldEvolution.ts prompts/runtime/worldEvolutionCot.ts hooks/useGame/systemPromptBuilder.ts __tests__/npcEvolutionSettlement.test.ts
git commit -m "feat: describe npc background settlements"
```

### Task 6: Pure NPC settlement bridge

**Files:**
- Create: `hooks/useGame/npcEvolutionSettlement.ts`
- Modify: `__tests__/npcEvolutionSettlement.test.ts`

- [ ] **Step 1: Write failing ID/name/status tests**

```ts
import { buildNpcSettlementCommands } from '../hooks/useGame/npcEvolutionSettlement';

it('persists a successful realm settlement by npc id', () => {
    const result = buildNpcSettlementCommands({
        social: [{ id: 'npc-1', 姓名: '沈青萝', 境界: '炼气圆满', 境界层级: 4, 当前装备: {}, 背包: [] }],
        activeNpcs: [{ npcId: 'npc-1', 姓名: '沈青萝', settlement: {
            status: 'success', reason: '完成七日闭关并服用筑基丹后突破',
            realmChange: { systemName: '道士', fromRealm: '炼气圆满', toRealm: '筑基初期', systemLevel: 1, powerLevel: 5 }
        }}]
    });
    expect(result.commands).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: 'set', key: '社交[0].境界', value: '筑基初期' }),
        expect.objectContaining({ action: 'set', key: '社交[0].境界层级', value: 5 })
    ]));
});

it.each(['pending', 'failed', 'interrupted'] as const)('does not persist %s settlements', (status) => {
    const result = buildNpcSettlementCommands({ social: [npc()], activeNpcs: [activeNpc({ status, reason: '未成功' })] });
    expect(result.commands).toEqual([]);
});

it('rejects ambiguous name matches', () => {
    const result = buildNpcSettlementCommands({ social: [npc('沈青萝'), npc('沈青萝')], activeNpcs: [activeNpc(successRealm())] });
    expect(result.commands).toEqual([]);
    expect(result.rejections[0]).toContain('姓名不唯一');
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test:run -- __tests__/npcEvolutionSettlement.test.ts`

Expected: import failure because bridge does not exist.

- [ ] **Step 3: Implement matching and realm validation**

The pure function returns `{ commands, rejections }`. Match by ID first, otherwise unique normalized name. Accept only `success`, require a non-empty reason, require current realm match, and reject decreases or invalid numeric levels.

- [ ] **Step 4: Add failing equipment consistency tests**

```ts
it('allows gain then equip of the same sourced item', () => {
    const result = buildNpcSettlementCommands({ social: [npc()], activeNpcs: [activeNpc({
        status: 'success', reason: '在宗门库房完成兑换', equipmentChanges: [
            { action: 'gain', itemName: '青锋剑', source: '宗门贡献兑换' },
            { action: 'equip', itemName: '青锋剑', source: '从新获得物品中穿戴', slot: '主武器' }
        ]
    })] });
    expect(result.commands.some((command) => command.key === '社交[0].当前装备.主武器')).toBe(true);
});

it('rejects equipment gain without a source', () => {
    const result = buildNpcSettlementCommands({ social: [npc()], activeNpcs: [activeNpc({
        status: 'success', reason: '获得装备', equipmentChanges: [{ action: 'gain', itemName: '青锋剑', source: '' }]
    })] });
    expect(result.commands).toEqual([]);
});
```

- [ ] **Step 5: Implement equipment action validation and minimal commands**

Support only known NPC equipment slots. Track a temporary inventory/equipment view through the ordered changes so `gain` followed by `equip` works. Reject nonexistent `lose/damage/unequip` targets. Generate only `当前装备`, `背包`, `能力体系`, `境界`, `境界层级`, and `记忆` paths.

- [ ] **Step 6: Verify GREEN**

Run: `npm run test:run -- __tests__/npcEvolutionSettlement.test.ts`

Expected: all settlement tests pass.

- [ ] **Step 7: Commit**

```powershell
git add hooks/useGame/npcEvolutionSettlement.ts __tests__/npcEvolutionSettlement.test.ts
git commit -m "feat: validate npc evolution settlements"
```

### Task 7: Integrate settlement commands into world evolution

**Files:**
- Modify: `hooks/useGame/worldEvolutionWorkflow.ts`
- Modify: `hooks/useGame/worldEvolutionUtils.ts`
- Modify: `__tests__/npcEvolutionSettlement.test.ts`
- Modify: `__tests__/worldEvolutionEvents.test.ts`

- [ ] **Step 1: Write failing workflow-level tests**

Add a test around an exported integration helper that receives normalized world commands, the resulting active NPC snapshot, and current `社交[]`, then returns separate `worldCommands`, `npcCommands`, and `rejections`. Assert that invalid direct `社交.*` model commands remain filtered while validated bridge commands are retained.

```ts
expect(result.worldCommands.every((command) => !command.key.startsWith('社交'))).toBe(true);
expect(result.npcCommands).toContainEqual(expect.objectContaining({ key: '社交[0].境界' }));
```

- [ ] **Step 2: Verify RED**

Run: `npm run test:run -- __tests__/npcEvolutionSettlement.test.ts __tests__/worldEvolutionEvents.test.ts`

Expected: integration helper does not exist.

- [ ] **Step 3: Implement integration after world-command normalization**

Apply normalized world commands first to the state base as today. Build settlement commands from the active NPC data produced by the model/current state, validate against `stateBase.社交`, then pass only validated commands through `processResponseCommands` in a second call.

Do not add `社交.*` to `规范化世界演变命令列表` allowed prefixes; the bridge remains the sole new authorization path.

- [ ] **Step 4: Surface rejection diagnostics without failing the turn**

Record rejection counts and concise reasons through the existing probe/log path. Do not expose internal-only diagnostics in customer world-event summaries.

- [ ] **Step 5: Verify GREEN and relevant regression suite**

Run: `npm run test:run -- __tests__/npcEvolutionSettlement.test.ts __tests__/worldEvolutionEvents.test.ts __tests__/responseCommandProcessor.test.ts __tests__/npcStateTransforms.test.ts`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```powershell
git add hooks/useGame/worldEvolutionWorkflow.ts hooks/useGame/worldEvolutionUtils.ts __tests__/npcEvolutionSettlement.test.ts __tests__/worldEvolutionEvents.test.ts
git commit -m "feat: persist validated npc background growth"
```

### Task 8: Full verification, UI QA, and PR preparation

**Files:**
- Modify if needed: files changed by Tasks 1-7 only
- Verify: `docs/superpowers/specs/2026-07-22-multi-realm-npc-evolution-design.md`

- [ ] **Step 1: Run the focused feature suite**

Run:

```powershell
npm run test:run -- __tests__/multiRealmDiy.test.ts __tests__/newGameDiyMultiSystemUi.test.tsx __tests__/npcEvolutionSettlement.test.ts __tests__/realmSystem.test.ts __tests__/realmConfig.test.ts __tests__/worldEvolutionEvents.test.ts __tests__/npcStateTransforms.test.ts __tests__/responseCommandProcessor.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run the complete test suite**

Run: `npm run test:run`

Expected: all test files pass.

- [ ] **Step 3: Run production build**

Run: `npm run build`

Expected: TypeScript/Vite build succeeds and `dist/` is generated without committing build artifacts.

- [ ] **Step 4: Verify DIY UI in dark and day themes**

Start a detached local server from `dist/`, open the new-game DIY realm editor at desktop and mobile sizes, add two systems, switch between them, edit rows, and confirm text contrast in day mode. Close the release modal before evidence screenshots.

- [ ] **Step 5: Review git scope**

Run:

```powershell
git status --short
git diff --check
git diff main...HEAD --stat
```

Expected: only feature, test, prompt, and design/plan files are included; no `dist`, logs, screenshots, traces, APKs, or local environment files.

- [ ] **Step 6: Commit final verification adjustments**

```powershell
git add -u
git commit -m "test: verify multi-realm npc evolution"
```

Skip the commit when verification required no source change.

- [ ] **Step 7: Push branch and create PR**

```powershell
git push -u origin codex/multi-realm-npc-evolution
gh pr create --base main --head codex/multi-realm-npc-evolution --title "支持多能力体系与离场 NPC 成长" --body "## 变更\n- DIY 境界支持主体系、副体系和共通战力档位\n- 离场 NPC 成功结算后可安全同步境界与装备\n- 保持旧存档及原有境界字段兼容\n\n## 验证\n- npm run test:run\n- npm run build\n- 桌面与移动端 DIY 界面日间/暗色主题检查"
```

Expected: branch is pushed and a PR URL is returned.

- [ ] **Step 8: Wait for CodeRabbit, address actionable findings, and reverify**

Read all review threads, reproduce each actionable issue with a failing test when it describes behavior, apply the minimal fix, rerun focused tests plus full build, push follow-up commits, and wait until CodeRabbit has no unresolved actionable request.

- [ ] **Step 9: Confirm CI and merge**

Verify the latest `CI` run belongs to `ypq123456789/MoRanJiangHu` and succeeds for the PR head commit. Merge the PR only after CodeRabbit review is addressed and required checks pass, then confirm `main` contains the merge commit.
