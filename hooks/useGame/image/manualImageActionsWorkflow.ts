import type { 香闺秘档部位类型 } from '../../../types';
import { recordDiagnosticLog } from '../../../services/diagnosticLog';
import { NPC是否扶她, NPC是否男性或男娘, NPC是否女性 } from '../../../utils/npcGenderFlags';
import { 解析视觉年龄 } from '../../../utils/visualAge';

type 右下角提示参数 = {
    title: string;
    message: string;
    tone?: 'info' | 'success' | 'error';
};

type 手动图片动作工作流依赖 = {
    获取社交列表: () => any[];
    获取开局配置?: () => any;
    NSFW模式已启用?: () => boolean;
    男娘NSFW内容已启用?: () => boolean;
    记录后台手动生图监控: (payload: { npcId: string; since: number; npcName: string; 构图: '头像' | '半身' | '立绘' }) => void;
    记录后台私密生图监控: (payload: { npcId: string; since: number; npcName: string; 部位: 香闺秘档部位类型 }) => void;
    推送右下角提示: (toast: 右下角提示参数) => void;
    执行单个NPC生图: (npc: any, options?: any) => Promise<void>;
    执行NPC香闺秘档部位生图: (npc: any, part: 香闺秘档部位类型, options?: any) => Promise<void>;
};

type 手动NPC生图选项 = {
    构图?: '头像' | '半身' | '立绘';
    画风?: any;
    画师串?: string;
    画师串预设ID?: string;
    PNG画风预设ID?: string;
    额外要求?: string;
    尺寸?: string;
    后台处理?: boolean;
};

type 手动私密生图选项 = {
    画风?: any;
    画师串?: string;
    画师串预设ID?: string;
    PNG画风预设ID?: string;
    额外要求?: string;
    尺寸?: string;
    后台处理?: boolean;
};

const 获取NPC名称 = (npc: any): string => (
    typeof npc?.姓名 === 'string' && npc.姓名.trim() ? npc.姓名.trim() : '未命名NPC'
);

const 女性香闺秘档部位列表: 香闺秘档部位类型[] = ['胸部', '小穴', '屁穴'];
const 男性香闺秘档部位列表: 香闺秘档部位类型[] = ['肉棒', '屁穴'];
const 扶她香闺秘档部位列表: 香闺秘档部位类型[] = ['胸部', '小穴', '屁穴', '肉棒'];
const 全部香闺秘档部位列表: 香闺秘档部位类型[] = ['胸部', '小穴', '屁穴', '肉棒'];
const 香闺秘档部位描述字段映射: Record<香闺秘档部位类型, string> = {
    胸部: '胸部描述',
    小穴: '小穴描述',
    屁穴: '屁穴描述',
    肉棒: '肉棒描述'
};
const 占位私密描述正则 = /^(?:空无|无|暂无|暂无记录|无记录|未记录|未知|不详|待补充|待完善|普通|正常|无描述)$/u;

const 读取NPC香闺秘档部位列表 = (npc: any): 香闺秘档部位类型[] => (
    NPC是否扶她(npc)
        ? 扶她香闺秘档部位列表
        : NPC是否男性或男娘(npc)
            ? 男性香闺秘档部位列表
            : 女性香闺秘档部位列表
);

const NPC是否允许私密部位生图 = (
    npc: any,
    options?: { femboyNsfwEnabled?: boolean }
): boolean => (
    (NPC是否扶她(npc) && options?.femboyNsfwEnabled === true)
    || (!NPC是否扶她(npc) && NPC是否女性(npc))
    || (options?.femboyNsfwEnabled === true && NPC是否男性或男娘(npc))
);

const NPC满足私密生图年龄安全 = (npc: any, openingConfig?: any): boolean => 解析视觉年龄({
    openingConfig,
    actualAge: npc?.年龄,
    explicitVisualAge: npc?.外观年龄,
    realmLevel: npc?.境界层级,
    realmText: npc?.境界,
    identity: npc?.身份,
    appearance: npc?.外貌描写 || npc?.外貌,
    body: npc?.身材描写 || npc?.身材,
    clothing: npc?.衣着风格 || npc?.衣着,
    bio: [npc?.简介, npc?.核心性格特征, npc?.性格].filter(Boolean).join('；'),
    race: npc?.种族,
    species: npc?.血统,
    additionalTexts: [npc?.灵根, npc?.灵根资质, npc?.男娘设定, npc?.扶她设定, npc?.性转记录]
}).isAdultSafetyApproved;

const 格式化香闺秘档部位数量 = (parts: 香闺秘档部位类型[]): string => {
    const count = Array.isArray(parts) ? parts.length : 0;
    if (count === 2) return '两处';
    if (count === 3) return '三处';
    if (count > 0) return `${count}处`;
    return '全部';
};

const 香闺秘档部位是否已生成 = (npc: any, part: 香闺秘档部位类型): boolean => {
    const result = npc?.图片档案?.香闺秘档部位档案?.[part];
    if (!result || typeof result !== 'object') return false;
    const hasAsset = Boolean(
        (typeof result?.图片URL === 'string' && result.图片URL.trim())
        || (typeof result?.本地路径 === 'string' && result.本地路径.trim())
    );
    return result?.状态 === 'success' && hasAsset;
};

const 读取NPC私密部位描述 = (npc: any, part: 香闺秘档部位类型): string => {
    const field = 香闺秘档部位描述字段映射[part];
    const value = typeof npc?.[field] === 'string' ? npc[field].trim() : '';
    if (!value || 占位私密描述正则.test(value)) return '';
    return value;
};

const 香闺秘档部位描述可用于生图 = (npc: any, part: 香闺秘档部位类型): boolean => (
    读取NPC私密部位描述(npc, part).length > 0
);

type 香闺秘档生成任务 = {
    npc: any;
    npcId: string;
    npcName: string;
    parts: 香闺秘档部位类型[];
};

const 收集香闺秘档生成任务 = (
    npcList: any[],
    targetNpc: any,
    requestedParts: 香闺秘档部位类型[],
    options?: { femboyNsfwEnabled?: boolean; openingConfig?: any }
): 香闺秘档生成任务[] => {
    const taskMap = new Map<string, 香闺秘档生成任务>();
    const addTask = (npc: any, parts: 香闺秘档部位类型[]) => {
        if (!NPC是否允许私密部位生图(npc, options)) return;
        if (!NPC满足私密生图年龄安全(npc, options?.openingConfig)) return;
        const npcId = typeof npc?.id === 'string' ? npc.id.trim() : '';
        const validParts = parts.filter((part) => 香闺秘档部位描述可用于生图(npc, part));
        if (!npcId || validParts.length <= 0) return;
        const existing = taskMap.get(npcId);
        const mergedParts = Array.from(new Set([...(existing?.parts || []), ...validParts]));
        taskMap.set(npcId, {
            npc,
            npcId,
            npcName: 获取NPC名称(npc),
            parts: 全部香闺秘档部位列表.filter((part) => mergedParts.includes(part))
        });
    };

    addTask(targetNpc, requestedParts);

    (Array.isArray(npcList) ? npcList : [])
        .filter((npc) => npc?.是否主要角色 === true && NPC是否允许私密部位生图(npc, options))
        .forEach((npc) => {
            const missingParts = 读取NPC香闺秘档部位列表(npc).filter((currentPart) => (
                香闺秘档部位描述可用于生图(npc, currentPart)
                && !香闺秘档部位是否已生成(npc, currentPart)
            ));
            addTask(npc, missingParts);
        });

    const targetNpcId = typeof targetNpc?.id === 'string' ? targetNpc.id.trim() : '';
    const tasks = Array.from(taskMap.values());
    return tasks.sort((a, b) => {
        if (a.npcId === targetNpcId) return -1;
        if (b.npcId === targetNpcId) return 1;
        return 0;
    });
};

const 构建香闺秘档补齐提示 = (
    targetNpcName: string,
    part: 香闺秘档部位类型 | '全部',
    tasks: 香闺秘档生成任务[],
    mode: '后台' | '前台'
): string => {
    const targetTask = tasks[0];
    const totalPartCount = tasks.reduce((sum, task) => sum + task.parts.length, 0);
    const targetPartCount = targetTask?.parts.length || 0;
    const extraPartCount = Math.max(0, totalPartCount - targetPartCount);
    const extraNpcCount = Math.max(0, tasks.filter((task) => task.npcId !== targetTask?.npcId).length);
    const targetPartLabel = 格式化香闺秘档部位数量(targetTask?.parts || []);
    const baseMessage = part === '全部'
        ? `${targetNpcName}的${targetPartLabel}特写已${mode === '后台' ? '转入后台生成' : '加入生成流程'}，可在图片队列查看进度。`
        : `${targetNpcName}的${part}特写已${mode === '后台' ? '转入后台生成' : '加入生成流程'}，可在图片队列查看进度。`;
    if (extraPartCount <= 0) return baseMessage;
    return `${baseMessage} 本轮还会补齐${extraNpcCount > 0 ? `${extraNpcCount}位` : ''}主要角色缺失的${extraPartCount}张香闺秘档特写。`;
};

export const 创建手动图片动作工作流 = (deps: 手动图片动作工作流依赖) => {
    const generateNpcImageManually = async (
        npcId: string,
        options?: 手动NPC生图选项
    ) => {
        if (!npcId) return;
        const targetNpc = (Array.isArray(deps.获取社交列表()) ? deps.获取社交列表() : []).find((npc: any) => npc && npc.id === npcId);
        if (!targetNpc) return;

        if (options?.后台处理) {
            deps.记录后台手动生图监控({
                npcId,
                since: Date.now(),
                npcName: 获取NPC名称(targetNpc),
                构图: options?.构图 || '头像'
            });
        }

        void deps.执行单个NPC生图(targetNpc, {
            force: true,
            source: 'manual',
            构图: options?.构图,
            画风: options?.画风,
            画师串: options?.画师串,
            画师串预设ID: options?.画师串预设ID,
            PNG画风预设ID: options?.PNG画风预设ID,
            额外要求: options?.额外要求,
            尺寸: options?.尺寸
        }).catch((error) => {
            recordDiagnosticLog('error', ['手动NPC生图任务执行失败', {
                message: error?.message || '',
                stack: typeof error?.stack === 'string' ? error.stack : undefined
            }]);
            console.error('手动NPC生图任务执行失败', error);
            deps.推送右下角提示({
                title: 'NPC生图失败',
                message: `「${获取NPC名称(targetNpc)}」${error?.message || '手动生图失败'}`,
                tone: 'error'
            });
        });
    };

    const generateNpcSecretPartImage = async (
        npcId: string,
        part: 香闺秘档部位类型 | '全部',
        options?: 手动私密生图选项
    ) => {
        if (!npcId) return;
        const socialList = Array.isArray(deps.获取社交列表()) ? deps.获取社交列表() : [];
        const targetNpc = socialList.find((npc: any) => npc && npc.id === npcId);
        if (!targetNpc) return;
        const nsfwEnabled = deps.NSFW模式已启用?.() === true;
        const femboyNsfwEnabled = deps.男娘NSFW内容已启用?.() === true;
        if (!nsfwEnabled) {
            deps.推送右下角提示({
                title: '私密特写未启用',
                message: '当前已关闭 NSFW 模式，男性/男娘/扶她角色不会生成私密部位特写。',
                tone: 'info'
            });
            return;
        }
        if (!NPC是否允许私密部位生图(targetNpc, { femboyNsfwEnabled })) {
            deps.推送右下角提示({
                title: '私密特写未启用',
                message: '当前已关闭男娘 / 扶她相关 NSFW 内容，男性/男娘/扶她角色不会生成私密部位特写。',
                tone: 'info'
            });
            return;
        }
        const openingConfig = deps.获取开局配置?.();
        if (!NPC满足私密生图年龄安全(targetNpc, openingConfig)) {
            deps.推送右下角提示({
                title: '私密特写未启用',
                message: '角色真实年龄或明确视觉年龄不满足成人私密生图要求。',
                tone: 'info'
            });
            return;
        }

        const targetParts: 香闺秘档部位类型[] = part === '全部' ? 读取NPC香闺秘档部位列表(targetNpc) : [part];
        const taskQueue = 收集香闺秘档生成任务(socialList, targetNpc, targetParts, { femboyNsfwEnabled, openingConfig });
        const npcName = 获取NPC名称(targetNpc);
        if (taskQueue.length <= 0) {
            deps.推送右下角提示({
                title: '暂无可生成的私密描述',
                message: part === '全部'
                    ? `${npcName}当前没有可用于生图的香闺秘档描述。请先继续剧情或在 NPC 管理里补齐部位描述。`
                    : `${npcName}的${part}描述为空或仍是占位文本，暂不能生成${part}特写。请先继续剧情或在 NPC 管理里补齐描述。`,
                tone: 'info'
            });
            return;
        }

        const executeTaskQueue = async () => {
            const errors: string[] = [];
            for (const task of taskQueue) {
                for (const currentPart of task.parts) {
                    try {
                        await deps.执行NPC香闺秘档部位生图(task.npc, currentPart, options);
                    } catch (error: any) {
                        const message = typeof error?.message === 'string' && error.message.trim()
                            ? error.message.trim()
                            : `${currentPart}特写生成失败`;
                        errors.push(`${task.npcName}·${currentPart}：${message}`);
                    }
                }
            }
            return errors;
        };

        if (options?.后台处理) {
            const monitorSince = Date.now();
            taskQueue.forEach((task) => {
                task.parts.forEach((currentPart) => {
                    deps.记录后台私密生图监控({
                        npcId: task.npcId,
                        since: monitorSince,
                        npcName: task.npcName,
                        部位: currentPart
                    });
                });
            });
            deps.推送右下角提示({
                title: '香闺秘档特写已提交',
                message: 构建香闺秘档补齐提示(npcName, part, taskQueue, '后台'),
                tone: 'info'
            });
            void (async () => {
                const errors = await executeTaskQueue();
                if (errors.length > 0) {
                    deps.推送右下角提示({
                        title: '香闺秘档特写失败',
                        message: errors.join('；'),
                        tone: 'error'
                    });
                }
            })();
            return;
        }

        deps.推送右下角提示({
            title: '香闺秘档特写已提交',
            message: 构建香闺秘档补齐提示(npcName, part, taskQueue, '前台'),
            tone: 'info'
        });
        const errors = await executeTaskQueue();
        if (errors.length > 0) {
            deps.推送右下角提示({
                title: '香闺秘档特写生成失败',
                message: errors.join('；'),
                tone: 'error'
            });
            throw new Error(errors.join('\n'));
        }
        deps.推送右下角提示({
            title: '香闺秘档特写生成完成',
            message: part === '全部'
                ? `${npcName}的${格式化香闺秘档部位数量(targetParts)}特写已全部写入图片档案。`
                : `${npcName}的${part}特写已写入图片档案。`,
            tone: 'success'
        });
    };

    const retryNpcImageGeneration = async (npcId: string, options?: Pick<手动NPC生图选项, '构图'>) => {
        if (!npcId) return;
        const targetNpc = (Array.isArray(deps.获取社交列表()) ? deps.获取社交列表() : []).find((npc: any) => npc && npc.id === npcId);
        if (!targetNpc) return;
        const allowedCompositions = ['头像', '半身', '立绘'];
        const requestedComp = allowedCompositions.includes(options?.构图 as string) ? options?.构图 : undefined;
        const comp = targetNpc?.图片档案?.最近生图结果?.构图 || targetNpc?.最近生图结果?.构图;
        const validComp = requestedComp || (allowedCompositions.includes(comp as string) ? (comp as '头像' | '半身' | '立绘') : undefined);
        await deps.执行单个NPC生图(targetNpc, {
            force: true,
            source: 'retry',
            构图: validComp
        }).catch((error) => {
            recordDiagnosticLog('error', ['重试NPC生图任务执行失败', {
                npcId,
                message: error?.message || '',
                stack: typeof error?.stack === 'string' ? error.stack : undefined
            }]);
            console.error('重试NPC生图任务执行失败', error);
            deps.推送右下角提示({
                title: 'NPC生图重试失败',
                message: `「${获取NPC名称(targetNpc)}」${error?.message || '重试生图失败'}`,
                tone: 'error'
            });
            throw error;
        });
    };

    return {
        generateNpcImageManually,
        generateNpcSecretPartImage,
        retryNpcImageGeneration
    };
};
