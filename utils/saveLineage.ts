import type { 存档结构 } from '../types';
import { 读取存档游玩回合数 } from './saveTurn';

const readText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const 截断连线文本 = (value: string): string => {
    const normalized = readText(value).replace(/\s+/g, ' ');
    if (!normalized) return '';
    return normalized.length > 42 ? `${normalized.slice(0, 42)}...` : normalized;
};

const 读取历史用户输入 = (save: Partial<存档结构>, startIndex = 0): string => {
    const history = Array.isArray(save.历史记录) ? save.历史记录 : [];
    const user = history.slice(Math.max(0, startIndex)).find((item: any) => item?.role === 'user' && readText(item.content));
    return 截断连线文本((user as any)?.content || '');
};

const 读取历史长度 = (save: Partial<存档结构>): number => {
    const history = Array.isArray(save.历史记录) ? save.历史记录 : [];
    const explicit = Number((save.元数据 as any)?.历史记录条数);
    if (Number.isFinite(explicit) && explicit > history.length) return Math.floor(explicit);
    return history.length;
};

const 读取首条历史签名 = (save: Partial<存档结构>): string => {
    const history = Array.isArray(save.历史记录) ? save.历史记录 : [];
    const first = history[0] as any;
    if (!first || typeof first !== 'object') return 'null';
    return JSON.stringify({
        role: first.role,
        content: typeof first.content === 'string' ? first.content.slice(0, 256).trim() : '',
        structuredResponse: Boolean(first.structuredResponse)
    });
};

const 是同一开局候选 = (save: Partial<存档结构>, candidate: Partial<存档结构>): boolean => {
    const currentName = readText(save.角色数据?.姓名);
    const candidateName = readText(candidate.角色数据?.姓名);
    if (currentName && candidateName && currentName !== candidateName) return false;

    const currentInitialTime = readText(save.游戏初始时间);
    const candidateInitialTime = readText(candidate.游戏初始时间);
    if (currentInitialTime && candidateInitialTime) return currentInitialTime === candidateInitialTime;

    const currentFirstHistory = 读取首条历史签名(save);
    const candidateFirstHistory = 读取首条历史签名(candidate);
    return currentFirstHistory === candidateFirstHistory;
};

const 读取谱系回合数 = (save: Partial<存档结构>): number => {
    // 轻量视图没有完整历史记录，元数据回合数是唯一可靠来源。
    // 这种场景下轻量视图的元数据回合数已经在保存时被正确写入，
    // 不需要从历史重新计算。
    const historyLength = Array.isArray(save?.历史记录) ? save.历史记录.length : 0;
    const explicitHistoryLength = Number((save?.元数据 as any)?.历史记录条数);
    const isLikelyLightweightView = Number.isFinite(explicitHistoryLength)
        && explicitHistoryLength > historyLength;
    if (isLikelyLightweightView) {
        const explicit = Number((save?.元数据 as any)?.游戏回合数);
        if (Number.isFinite(explicit) && explicit >= 0) return Math.floor(explicit);
    }
    return 读取存档游玩回合数(save);
};

export const 计算谱系短哈希 = (value: string): string => {
    let left = 0x811c9dc5;
    let right = 0x01000193;
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        left ^= code;
        left = Math.imul(left, 0x01000193);
        right ^= code + index;
        right = Math.imul(right, 0x811c9dc5);
    }
    return `${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}`;
};

export const 读取存档系列ID = (save: Partial<存档结构>): string => {
    const existing = readText((save.元数据 as any)?.存档系列ID);
    if (existing) return existing;
    const history = Array.isArray(save.历史记录) ? save.历史记录 : [];
    const firstHistory = history[0] || null;
    const env: any = save.环境信息 || {};
    const seed = {
        title: readText(save.角色数据?.姓名),
        initialTime: readText(save.游戏初始时间),
        firstHistory,
        firstLocation: readText(env.具体地点 || env.小地点 || env.中地点 || env.大地点)
    };
    return `series-${计算谱系短哈希(JSON.stringify(seed))}`;
};

export const 读取存档谱系哈希 = (save: Partial<存档结构>): string => (
    readText((save.元数据 as any)?.存档哈希)
);

export const 选择存档父节点 = (
    save: Partial<存档结构>,
    candidates: Array<Partial<存档结构>>
): Partial<存档结构> | null => {
    const seriesId = 读取存档系列ID(save);
    const currentHash = 读取存档谱系哈希(save);
    const currentAutoNodeId = readText((save.元数据 as any)?.自动存档节点ID);
    const historyCount = 读取历史长度(save);
    const timestamp = Number(save.时间戳 || 0);
    const explicitParentHash = readText((save.元数据 as any)?.存档父节点哈希);
    if (explicitParentHash) {
        const explicit = candidates.find((item) => 读取存档谱系哈希(item) === explicitParentHash);
        if (explicit) return explicit;
    }
    return candidates
        .filter((item) => 读取存档谱系哈希(item) && 读取存档谱系哈希(item) !== currentHash)
        .filter((item) => !currentAutoNodeId || readText((item.元数据 as any)?.自动存档节点ID) !== currentAutoNodeId)
        .filter((item) => 读取存档系列ID(item) === seriesId)
        .filter((item) => 读取历史长度(item) <= historyCount)
        .filter((item) => Number(item.时间戳 || 0) <= timestamp || timestamp <= 0)
        .sort((a, b) => {
            const byHistory = 读取历史长度(b) - 读取历史长度(a);
            if (byHistory !== 0) return byHistory;
            return Number(b.时间戳 || 0) - Number(a.时间戳 || 0);
        })[0] || null;
};

const 选择可继承系列父节点 = (
    save: Partial<存档结构>,
    candidates: Array<Partial<存档结构>>
): Partial<存档结构> | null => {
    const currentHash = 读取存档谱系哈希(save);
    const currentAutoNodeId = readText((save.元数据 as any)?.自动存档节点ID);
    const historyCount = 读取历史长度(save);
    const timestamp = Number(save.时间戳 || 0);
    return candidates
        .filter((item) => 读取存档谱系哈希(item) && 读取存档谱系哈希(item) !== currentHash)
        .filter((item) => readText((item.元数据 as any)?.存档系列ID))
        .filter((item) => !currentAutoNodeId || readText((item.元数据 as any)?.自动存档节点ID) !== currentAutoNodeId)
        .filter((item) => 是同一开局候选(save, item))
        .filter((item) => 读取历史长度(item) <= historyCount)
        .filter((item) => Number(item.时间戳 || 0) <= timestamp || timestamp <= 0)
        .sort((a, b) => {
            const byHistory = 读取历史长度(b) - 读取历史长度(a);
            if (byHistory !== 0) return byHistory;
            return Number(b.时间戳 || 0) - Number(a.时间戳 || 0);
        })[0] || null;
};

export const 补全存档谱系元数据 = <T extends Partial<存档结构>>(
    save: T,
    candidates: Array<Partial<存档结构>> = []
): T => {
    const metadata: Record<string, unknown> = {
        ...((save.元数据 && typeof save.元数据 === 'object') ? save.元数据 : {})
    };
    const inheritedParent = !readText(metadata.存档系列ID)
        ? 选择可继承系列父节点({ ...save, 元数据: metadata } as Partial<存档结构>, candidates)
        : null;
    const inheritedSeriesId = readText((inheritedParent?.元数据 as any)?.存档系列ID);
    const seriesId = readText(metadata.存档系列ID) || inheritedSeriesId || 读取存档系列ID({ ...save, 元数据: metadata } as Partial<存档结构>);
    metadata.存档系列ID = seriesId;
    const explicitParentHash = readText(metadata.存档父节点哈希);
    const explicitRootHash = readText(metadata.存档根节点哈希);
    const explicitDepth = Number(metadata.存档谱系深度);
    const parent = 选择存档父节点({ ...save, 元数据: metadata } as Partial<存档结构>, candidates);
    const parentHash = parent ? 读取存档谱系哈希(parent) : explicitParentHash;
    const parentHistoryCount = parent ? 读取历史长度(parent) : 0;
    const existingBranchInput = readText(metadata.存档分支输入);
    const branchInput = parent
        ? 读取历史用户输入(save, parentHistoryCount)
        : (!parentHash && !existingBranchInput ? 读取历史用户输入(save, 0) : '');
    const rootHash = parent
        ? readText((parent.元数据 as any)?.存档根节点哈希) || parentHash
        : explicitRootHash || readText(metadata.存档哈希) || parentHash;
    if (parentHash) {
        metadata.存档父节点哈希 = parentHash;
        metadata.存档根节点哈希 = rootHash || readText(metadata.存档哈希);
        metadata.存档谱系深度 = parent
            ? Math.max(0, Number((parent.元数据 as any)?.存档谱系深度 || 0) + 1)
            : (Number.isFinite(explicitDepth) && explicitDepth > 0 ? Math.floor(explicitDepth) : 1);
        metadata.存档分支输入 = branchInput || existingBranchInput || '继续游玩';
    } else {
        const selfHash = readText(metadata.存档哈希);
        metadata.存档父节点哈希 = '';
        metadata.存档根节点哈希 = selfHash || rootHash || '';
        metadata.存档谱系深度 = 0;
        metadata.游戏回合数 = 0;
        metadata.存档分支输入 = '开局';
    }
    metadata.存档谱系版本 = 1;
    return {
        ...save,
        元数据: metadata as any
    };
};

export interface 本地存档谱系修复结果<T extends Partial<存档结构>> {
    saves: T[];
    changed: boolean;
    repairedGroups: number;
    repairedNodes: number;
}

const 比较谱系顺序 = (a: Partial<存档结构>, b: Partial<存档结构>): number => {
    const turnDiff = 读取谱系回合数(a) - 读取谱系回合数(b);
    if (turnDiff !== 0) return turnDiff;
    const depthDiff = Number((a.元数据 as any)?.存档谱系深度 || 0) - Number((b.元数据 as any)?.存档谱系深度 || 0);
    if (depthDiff !== 0) return depthDiff;
    return Number(a.时间戳 || 0) - Number(b.时间戳 || 0);
};

const 是可信谱系根 = (item: Partial<存档结构>): boolean => (
    !readText((item.元数据 as any)?.存档父节点哈希)
    && 读取谱系回合数(item) === 0
    && Number((item.元数据 as any)?.存档谱系深度 || 0) === 0
);

const 收集谱系子树 = <T extends Partial<存档结构>>(
    root: T,
    childrenByParent: Map<string, T[]>
): T[] => {
    const collected: T[] = [];
    const seen = new Set<string>();
    const walk = (item: T) => {
        const hash = 读取存档谱系哈希(item);
        if (!hash || seen.has(hash)) return;
        seen.add(hash);
        collected.push(item);
        const children = [...(childrenByParent.get(hash) || [])].sort(比较谱系顺序);
        children.forEach(walk);
    };
    walk(root);
    return collected;
};

const 写入谱系节点元数据 = <T extends Partial<存档结构>>(
    ordered: T[],
    rootHash: string,
    seriesId: string,
    startIndex = 0,
    parentBeforeFirst = ''
): number => {
    let repairedNodes = 0;
    ordered.forEach((save, offset) => {
        const metadata = save.元数据 as any;
        const index = startIndex + offset;
        const nextGameRound = 读取谱系回合数(save);
        const nextParentHash = index === 0 ? '' : (offset === 0 ? parentBeforeFirst : 读取存档谱系哈希(ordered[offset - 1]));
        const nextBranchInput = index === 0 ? '开局' : (readText(metadata.存档分支输入) || 读取历史用户输入(save, 0) || '继续游玩');
        if (
            metadata.存档系列ID !== seriesId
            || metadata.存档根节点哈希 !== rootHash
            || metadata.存档父节点哈希 !== nextParentHash
            || metadata.存档谱系深度 !== index
            || metadata.游戏回合数 !== nextGameRound
            || metadata.存档分支输入 !== nextBranchInput
            || metadata.存档谱系版本 !== 1
        ) {
            repairedNodes += 1;
        }
        metadata.存档系列ID = seriesId;
        metadata.存档根节点哈希 = rootHash;
        metadata.存档父节点哈希 = nextParentHash;
        metadata.存档谱系深度 = index;
        metadata.游戏回合数 = nextGameRound;
        metadata.存档分支输入 = nextBranchInput;
        metadata.存档谱系版本 = 1;
    });
    return repairedNodes;
};

export const 修复本地存档谱系列表 = <T extends Partial<存档结构>>(
    saves: T[]
): 本地存档谱系修复结果<T> => {
    const next = saves.map((save) => ({
        ...save,
        元数据: {
            ...((save.元数据 && typeof save.元数据 === 'object') ? save.元数据 : {})
        }
    })) as T[];
    const bySeries = new Map<string, T[]>();
    next.forEach((save) => {
        const seriesId = readText((save.元数据 as any)?.存档系列ID);
        const hash = 读取存档谱系哈希(save);
        if (!seriesId || !hash) return;
        bySeries.set(seriesId, [...(bySeries.get(seriesId) || []), save]);
    });

    let repairedGroups = 0;
    let repairedNodes = 0;
    bySeries.forEach((items) => {
        const hashToItem = new Map(items.map((item) => [读取存档谱系哈希(item), item]).filter(([hash]) => Boolean(hash)) as Array<[string, T]>);
        const childrenByParent = new Map<string, T[]>();
        items.forEach((item) => {
            const parentHash = readText((item.元数据 as any)?.存档父节点哈希);
            if (!parentHash || !hashToItem.has(parentHash)) return;
            childrenByParent.set(parentHash, [...(childrenByParent.get(parentHash) || []), item]);
        });

        const trueRoots = items.filter(是可信谱系根).sort(比较谱系顺序);
        if (trueRoots.length <= 0) {
            const ordered = [...items].sort(比较谱系顺序);
            const first = ordered[0];
            const rootHash = 读取存档谱系哈希(first);
            const seriesId = readText((first?.元数据 as any)?.存档系列ID);
            if (!rootHash || !seriesId) return;
            const groupChanged = 写入谱系节点元数据(ordered, rootHash, seriesId, 0, '');
            if (groupChanged > 0) {
                repairedNodes += groupChanged;
                repairedGroups += 1;
            }
            return;
        }

        const primaryRoot = trueRoots[0];
        const primaryRootHash = 读取存档谱系哈希(primaryRoot);
        const primarySeriesId = readText((primaryRoot.元数据 as any)?.存档系列ID);
        const used = new Set<string>();
        let groupChanged = 0;
        const primaryComponent = 收集谱系子树(primaryRoot, childrenByParent);
        primaryComponent.forEach((item) => used.add(读取存档谱系哈希(item)));
        groupChanged += 写入谱系节点元数据(primaryComponent, primaryRootHash, primarySeriesId, 0, '');
        const unattachedRoots = items
            .filter((item) => {
                const hash = 读取存档谱系哈希(item);
                if (!hash || used.has(hash)) return false;
                const parentHash = readText((item.元数据 as any)?.存档父节点哈希);
                if (!parentHash) return true;
                return !hashToItem.has(parentHash);
            })
            .sort(比较谱系顺序);
        let previousHash = primaryRootHash;
        let nextIndex = primaryComponent.length;
        unattachedRoots.forEach((root) => {
            if (!primaryRootHash || !previousHash) return;
            const component = 收集谱系子树(root, childrenByParent);
            component.forEach((item) => used.add(读取存档谱系哈希(item)));
            groupChanged += 写入谱系节点元数据(component, primaryRootHash, primarySeriesId, nextIndex, previousHash);
            previousHash = 读取存档谱系哈希(component[component.length - 1]) || previousHash;
            nextIndex += component.length;
        });

        if (groupChanged > 0) {
            repairedNodes += groupChanged;
            repairedGroups += 1;
        }
    });

    return {
        saves: next,
        changed: repairedNodes > 0,
        repairedGroups,
        repairedNodes
    };
};
