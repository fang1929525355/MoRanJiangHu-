import {
    酒馆预设兼容性结构,
    酒馆预设结构,
    酒馆预设消息角色类型,
    酒馆预设顺序结构,
    酒馆预设顺序项结构,
    酒馆预设提示词结构,
    Instruct模板结构,
    Context模板结构,
    SystemPrompt模板结构,
    Reasoning模板结构,
    酒馆预设生成参数结构,
    酒馆正则脚本结构,
    酒馆正则脚本分类条目,
    酒馆正则脚本安全类型,
    酒馆正则脚本执行状态,
} from '../models/system';
import { 规范化正则脚本, 分类正则脚本, 提取并分类正则脚本 } from './tavernRegexEngine';

const 读取文本 = (value: unknown): string => (typeof value === 'string' ? value : '');
const 读取布尔 = (value: unknown): boolean => value === true;
const 读取数值 = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return Math.floor(parsed);
    }
    return null;
};
const 读取浮点数 = (value: unknown): number | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    return undefined;
};

const 深拷贝JSON对象 = (value: unknown): Record<string, unknown> | undefined => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    try {
        return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
    } catch {
        return undefined;
    }
};

const 读取正则脚本列表 = (extensions: Record<string, unknown> | undefined): any[] => {
    const scripts = (extensions as any)?.regex_scripts;
    return Array.isArray(scripts) ? scripts.filter(item => item && typeof item === 'object') : [];
};

const 是否选项渲染脚本 = (script: any): boolean => {
    if (script?.disabled === true) return false;
    const findRegex = 读取文本(script?.findRegex).toLowerCase();
    const replaceString = 读取文本(script?.replaceString).toLowerCase();
    const scriptName = 读取文本(script?.scriptName).toLowerCase();
    const targetsOptionBlock = /<\s*(options|branches)/.test(findRegex);
    const rendersHtml = /```html|<!doctype html|<html|<style|class\s*=/.test(replaceString);
    return /data-option-text|option-link|option-list/.test(replaceString)
        || (targetsOptionBlock && rendersHtml && /选项栏|option|choice/.test(scriptName));
};

const 是否危险脚本 = (script: any): boolean => {
    const replaceString = 读取文本(script?.replaceString);
    return /<\s*script\b|javascript\s*:|window\.|document\.|localStorage|sessionStorage|fetch\s*\(|XMLHttpRequest|eval\s*\(/i.test(replaceString);
};

/** 检测含 JS 的脚本是否可桥接到沙箱 iframe（与 tavernRegexEngine.ts 同步） */
const 是否可桥接JS脚本 = (script: any): boolean => {
    const replaceString = 读取文本(script?.replaceString);

    // ❌ 外部脚本加载
    if (/<\s*script\b[^>]*\bsrc\s*=/i.test(replaceString)) return false;
    // ❌ 任意网络请求
    if (/\bfetch\s*\(|XMLHttpRequest/i.test(replaceString)) return false;
    // ❌ 复杂存储 API
    if (/\bindexedDB\b|\bcrypto\.subtle\b/i.test(replaceString)) return false;
    // ❌ 远程资源加载
    if (/@import\s+url\s*\(/i.test(replaceString)) return false;
    // ❌ 深度 DOM 遍历
    if (/window\.__dcHostBridge|__dc-html-embed/i.test(replaceString)) return false;

    return true;
};

const 是否包含HTML渲染 = (script: any): boolean => {
    const findRegex = 读取文本(script?.findRegex);
    const replaceString = 读取文本(script?.replaceString);
    return /<[a-z][\s\S]*?>/i.test(replaceString)
        || /<!--|<!\s*--?/i.test(replaceString)
        || /<(?:details|summary|html|body|style|script|div|span|button|section|article)\b/i.test(findRegex);
};

const 是否安全清理脚本 = (script: any): boolean => (
    !是否选项渲染脚本(script)
    && !是否危险脚本(script)
    && !是否包含HTML渲染(script)
);

/** 对原始脚本 JSON 做安全分类（5 级） */
const 分类原始脚本 = (script: any): 酒馆正则脚本安全类型 => {
    if (是否危险脚本(script)) {
        return 是否可桥接JS脚本(script) ? 'JS交互' : '仍跳过';
    }
    if (是否选项渲染脚本(script)) return '选项渲染';
    if (是否包含HTML渲染(script)) return 'HTML美化';
    return '安全清理';
};

/** 根据安全类型映射执行状态注解 */
const 安全类型到执行状态 = (safetyType: 酒馆正则脚本安全类型): 酒馆正则脚本执行状态 => {
    switch (safetyType) {
        case '安全清理': return '已安全执行';
        case '选项渲染': return '已适配为选项按钮';
        case 'HTML美化': return 'HTML美化已执行';
        case 'JS交互': return 'iframe沙箱已渲染';
        case '仍跳过': return '已跳过';
    }
};

const 构建酒馆兼容性 = (extensions: Record<string, unknown> | undefined): 酒馆预设兼容性结构 | undefined => {
    const scripts = 读取正则脚本列表(extensions);
    if (scripts.length === 0) return undefined;

    const optionRenderScripts = scripts.filter(是否选项渲染脚本);
    const dangerousScripts = scripts.filter(是否危险脚本);
    const jsInteractiveScripts = dangerousScripts.filter(是否可桥接JS脚本);
    const stillSkippedScripts = dangerousScripts.filter(s => !是否可桥接JS脚本(s));
    const htmlRenderScripts = scripts.filter(s => !是否选项渲染脚本(s) && !是否危险脚本(s) && 是否包含HTML渲染(s));
    const safeCleanupScripts = scripts.filter(s => 是否安全清理脚本(s));
    const metadataOnlyScripts = scripts.filter(script => (
        !是否选项渲染脚本(script) && !是否安全清理脚本(script) && !是否危险脚本(script) && !是否包含HTML渲染(script)
    ));

    const 说明: string[] = [
        `已保留 ${scripts.length} 个 regex_scripts 扩展。`,
    ];

    // 构建分类脚本列表
    const 已分类脚本列表: 酒馆正则脚本分类条目[] = scripts.map(script => {
        const normalized = 规范化正则脚本(script);
        const safetyType = 分类原始脚本(script);
        const executionStatus = 安全类型到执行状态(safetyType);
        return normalized ? { script: normalized, safetyType, executionStatus } : null;
    }).filter((item): item is 酒馆正则脚本分类条目 => item !== null);

    if (safeCleanupScripts.length > 0) {
        说明.push(`✅ 识别到 ${safeCleanupScripts.length} 个安全清理脚本，将在响应管道中自动执行。`);
    }
    if (optionRenderScripts.length > 0) {
        说明.push(`🔘 识别到 ${optionRenderScripts.length} 个选项渲染脚本，将安全适配为本项目的选项按钮。`);
    }
    if (htmlRenderScripts.length > 0) {
        说明.push(`🎨 识别到 ${htmlRenderScripts.length} 个 HTML 美化脚本，正则部分将安全执行，HTML 由渲染器安全处理。`);
    }
    if (jsInteractiveScripts.length > 0) {
        说明.push(`🔗 识别到 ${jsInteractiveScripts.length} 个 JS 交互脚本，将在沙箱 iframe 中安全渲染，交互通过桥接协议映射。`);
    }
    if (stillSkippedScripts.length > 0) {
        说明.push(`⚠️ 识别到 ${stillSkippedScripts.length} 个含不可桥接操作（外部脚本/网络请求/复杂存储）的脚本，已跳过不执行。`);
    }
    if (metadataOnlyScripts.length > 0) {
        说明.push(`📋 有 ${metadataOnlyScripts.length} 个脚本仅保留元数据，不直接执行。`);
    }
    说明.push('沙箱 iframe 隔离执行 JS 交互; 不可桥接的外部脚本和网络能力仍跳过; 选项栏转为本项目安全按钮。');

    return {
        正则脚本总数: scripts.length,
        安全清理脚本数: safeCleanupScripts.length,
        选项渲染脚本数: optionRenderScripts.length,
        HTML美化脚本数: htmlRenderScripts.length,
        JS交互脚本数: jsInteractiveScripts.length,
        仍跳过脚本数: stillSkippedScripts.length,
        危险跳过脚本数: stillSkippedScripts.length, // 向后兼容别名
        仅保留元数据脚本数: metadataOnlyScripts.length,
        说明,
        已分类脚本列表,
    };
};

const 规范化角色 = (raw: unknown, systemPrompt: unknown): 酒馆预设消息角色类型 => {
    if (raw === 'system' || raw === 'user' || raw === 'assistant') return raw;
    if (systemPrompt === true) return 'system';
    return 'system';
};

const 规范化提示词 = (raw: unknown): 酒馆预设提示词结构 | null => {
    if (!raw || typeof raw !== 'object') return null;
    const source = raw as any;
    const identifier = 读取文本(source.identifier).trim();
    if (!identifier) return null;
    const name = 读取文本(source.name || source.title).trim();
    return {
        identifier,
        ...(name ? { name } : {}),
        role: 规范化角色(source.role, source.system_prompt),
        content: 读取文本(source.content),
        system_prompt: 读取布尔(source.system_prompt),
        marker: 读取布尔(source.marker),
        injection_position: typeof source.injection_position === 'number' && Number.isFinite(source.injection_position)
            ? source.injection_position : undefined,
        injection_depth: typeof source.injection_depth === 'number' && Number.isFinite(source.injection_depth)
            ? source.injection_depth : undefined,
        injection_order: typeof source.injection_order === 'number' && Number.isFinite(source.injection_order)
            ? source.injection_order : undefined,
        enabled: source.enabled !== false ? undefined : false,
    };
};

const 规范化顺序项 = (raw: unknown): 酒馆预设顺序项结构 | null => {
    if (!raw || typeof raw !== 'object') return null;
    const source = raw as any;
    const identifier = 读取文本(source.identifier).trim();
    if (!identifier) return null;
    return {
        identifier,
        enabled: source.enabled !== false
    };
};

const 规范化顺序 = (raw: unknown): 酒馆预设顺序结构 | null => {
    if (!raw || typeof raw !== 'object') return null;
    const source = raw as any;
    const characterId = 读取数值(source.character_id);
    const orderRaw = Array.isArray(source.order) ? source.order : [];
    const order = orderRaw
        .map((item) => 规范化顺序项(item))
        .filter((item): item is 酒馆预设顺序项结构 => Boolean(item));
    if (characterId === null || order.length === 0) return null;
    return {
        character_id: characterId,
        order
    };
};

// ─── Instruct / Context / Sysprompt / Reasoning 规范化 ───

const 规范化Instruct模板 = (raw: any): Instruct模板结构 | null => {
    if (!raw || typeof raw !== 'object') return null;
    const name = 读取文本(raw.name).trim();
    const input_sequence = 读取文本(raw.input_sequence);
    const output_sequence = 读取文本(raw.output_sequence);
    // 验证: 必须同时有 name, input_sequence, output_sequence
    if (!name && !input_sequence && !output_sequence) return null;
    return {
        name: name || 'Unnamed',
        input_sequence,
        output_sequence,
        input_suffix: 读取文本(raw.input_suffix),
        output_suffix: 读取文本(raw.output_suffix),
        system_sequence: 读取文本(raw.system_sequence),
        system_suffix: 读取文本(raw.system_suffix),
        stop_sequence: 读取文本(raw.stop_sequence),
        wrap: 读取布尔(raw.wrap),
        macro: 读取布尔(raw.macro),
        names_behavior: raw.names_behavior === 'force' || raw.names_behavior === 'surround'
            ? raw.names_behavior
            : 'none',
        activation_regex: 读取文本(raw.activation_regex),
        first_input_sequence: 读取文本(raw.first_input_sequence),
        first_output_sequence: 读取文本(raw.first_output_sequence),
        last_input_sequence: 读取文本(raw.last_input_sequence),
        last_output_sequence: 读取文本(raw.last_output_sequence),
        last_system_sequence: 读取文本(raw.last_system_sequence),
        story_string_prefix: 读取文本(raw.story_string_prefix),
        story_string_suffix: 读取文本(raw.story_string_suffix),
        skip_examples: 读取布尔(raw.skip_examples),
        user_alignment_message: 读取文本(raw.user_alignment_message),
        system_same_as_user: 读取布尔(raw.system_same_as_user),
        sequences_as_stop_strings: 读取布尔(raw.sequences_as_stop_strings),
    };
};

const 规范化Context模板 = (raw: any): Context模板结构 | null => {
    if (!raw || typeof raw !== 'object') return null;
    const name = 读取文本(raw.name).trim();
    const story_string = 读取文本(raw.story_string);
    if (!name && !story_string) return null;
    return {
        name: name || 'Unnamed',
        story_string,
        example_separator: 读取文本(raw.example_separator),
        chat_start: 读取文本(raw.chat_start),
        use_stop_strings: raw.use_stop_strings === true,
        names_as_stop_strings: raw.names_as_stop_strings === true,
        story_string_position: typeof raw.story_string_position === 'number' ? raw.story_string_position : undefined,
        story_string_depth: typeof raw.story_string_depth === 'number' ? raw.story_string_depth : undefined,
        story_string_role: typeof raw.story_string_role === 'number' ? raw.story_string_role : undefined,
        always_force_name2: raw.always_force_name2 === true,
        trim_sentences: raw.trim_sentences === true,
        single_line: raw.single_line === true,
    };
};

const 规范化SystemPrompt模板 = (raw: any): SystemPrompt模板结构 | null => {
    if (!raw || typeof raw !== 'object') return null;
    const name = 读取文本(raw.name).trim();
    const content = 读取文本(raw.content);
    if (!name && !content) return null;
    return {
        name: name || 'Unnamed',
        content,
        post_history: 读取文本(raw.post_history),
    };
};

const 规范化Reasoning模板 = (raw: any): Reasoning模板结构 | null => {
    if (!raw || typeof raw !== 'object') return null;
    const name = 读取文本(raw.name).trim();
    const prefix = 读取文本(raw.prefix);
    const suffix = 读取文本(raw.suffix);
    const separator = 读取文本(raw.separator);
    if (!name && !prefix && !suffix && !separator) return null;
    return {
        name: name || 'Unnamed',
        prefix,
        suffix,
        separator,
    };
};

// ─── 生成参数提取 ───

const 提取生成参数 = (raw: any): 酒馆预设生成参数结构 | undefined => {
    if (!raw || typeof raw !== 'object') return undefined;

    const source = raw.generationParams && typeof raw.generationParams === 'object'
        ? raw.generationParams
        : raw;
    const params: 酒馆预设生成参数结构 = {};
    let hasAny = false;

    if (typeof source.temperature === 'number' && Number.isFinite(source.temperature)) {
        params.temperature = source.temperature;
        hasAny = true;
    }
    if (typeof source.top_p === 'number' && Number.isFinite(source.top_p)) {
        params.top_p = source.top_p;
        hasAny = true;
    }
    if (typeof source.top_k === 'number' && Number.isFinite(source.top_k)) {
        params.top_k = source.top_k;
        hasAny = true;
    }
    if (typeof source.frequency_penalty === 'number' && Number.isFinite(source.frequency_penalty)) {
        params.frequency_penalty = source.frequency_penalty;
        hasAny = true;
    }
    if (typeof source.presence_penalty === 'number' && Number.isFinite(source.presence_penalty)) {
        params.presence_penalty = source.presence_penalty;
        hasAny = true;
    }
    if (typeof source.repetition_penalty === 'number' && Number.isFinite(source.repetition_penalty)) {
        params.repetition_penalty = source.repetition_penalty;
        hasAny = true;
    }
    const maxTokens = source.max_tokens ?? source.openai_max_tokens;
    if (typeof maxTokens === 'number' && Number.isFinite(maxTokens) && maxTokens > 0) {
        params.max_tokens = maxTokens;
        hasAny = true;
    }
    const maxContext = source.max_context ?? source.openai_max_context;
    if (typeof maxContext === 'number' && Number.isFinite(maxContext) && maxContext > 0) {
        params.max_context = maxContext;
        hasAny = true;
    }
    const stream = source.stream ?? source.stream_openai;
    if (typeof stream === 'boolean') {
        params.stream = stream;
        hasAny = true;
    }
    if (typeof source.assistant_prefill === 'string' && source.assistant_prefill.trim()) {
        params.assistant_prefill = source.assistant_prefill.trim();
        hasAny = true;
    }
    if (typeof source.continue_prefill === 'boolean') {
        params.continue_prefill = source.continue_prefill;
        hasAny = true;
    }
    if (typeof source.custom_prompt_post_processing === 'string' && source.custom_prompt_post_processing.trim()) {
        params.custom_prompt_post_processing = source.custom_prompt_post_processing.trim();
        hasAny = true;
    }

    return hasAny ? params : undefined;
};

// ─── Master Import 检测 ───

/**
 * 检测原始 JSON 是否为 SillyTavern Master Export 格式
 * Master Export 包含 top-level 的 "instruct", "context", "sysprompt", "preset" 等 key
 */
const 是否MasterExport格式 = (raw: any): boolean => {
    if (!raw || typeof raw !== 'object') return false;
    const keys = Object.keys(raw);
    // 至少包含两个或以上 Master 格式的 key
    const masterKeys = ['instruct', 'context', 'sysprompt', 'reasoning', 'preset', 'srw'];
    const matchCount = keys.filter(k => masterKeys.includes(k)).length;
    return matchCount >= 2;
};

/**
 * 从 Master Export 中提取核心预设数据
 * Master Export: { instruct, context, sysprompt, preset, reasoning, srw }
 * 其中 "preset" 包含 OpenAI preset（有 prompts/prompt_order）
 */
const 从MasterExport提取核心数据 = (raw: any): any => {
    // "preset" key 包含 OpenAI 预设的核心数据
    if (raw.preset && typeof raw.preset === 'object') {
        return {
            ...raw.preset,
            // 保留 Master 的子部分引用
            _master_instruct: raw.instruct,
            _master_context: raw.context,
            _master_sysprompt: raw.sysprompt,
            _master_reasoning: raw.reasoning,
            _master_srw: raw.srw,
        };
    }
    // 如果没有 "preset" key，尝试直接从 raw 提取 prompts/prompt_order
    if (raw.prompts || raw.prompt_order) return raw;
    return raw;
};

// ─── 主规范化函数 ───

export const 规范化酒馆预设 = (raw: unknown): 酒馆预设结构 | null => {
    if (!raw || typeof raw !== 'object') return null;
    let source = raw as any;

    // 检测 Master Export 格式
    if (是否MasterExport格式(source)) {
        source = 从MasterExport提取核心数据(source);
    }

    const promptsRaw = Array.isArray(source.prompts) ? source.prompts : [];
    const promptOrderRaw = Array.isArray(source.prompt_order) ? source.prompt_order : [];

    const prompts = promptsRaw
        .map((item) => 规范化提示词(item))
        .filter((item): item is 酒馆预设提示词结构 => Boolean(item));
    const prompt_order = promptOrderRaw
        .map((item) => 规范化顺序(item))
        .filter((item): item is 酒馆预设顺序结构 => Boolean(item));

    if (prompts.length === 0 || prompt_order.length === 0) return null;

    const extensions = 深拷贝JSON对象(source.extensions);
    const 兼容性 = 构建酒馆兼容性(extensions);

    // 提取 Instruct / Context / Sysprompt / Reasoning（支持直传和 Master 两种来源）
    const instruct = 规范化Instruct模板(source.instruct || source._master_instruct);
    const context = 规范化Context模板(source.context || source._master_context);
    const sysprompt = 规范化SystemPrompt模板(source.sysprompt || source._master_sysprompt);
    const reasoning = 规范化Reasoning模板(source.reasoning || source._master_reasoning);

    // 提取生成参数
    const generationParams = 提取生成参数(source);

    return {
        prompts,
        prompt_order,
        ...(extensions ? { extensions } : {}),
        ...(兼容性 ? { 兼容性 } : {}),
        ...(instruct ? { instruct } : {}),
        ...(context ? { context } : {}),
        ...(sysprompt ? { sysprompt } : {}),
        ...(reasoning ? { reasoning } : {}),
        ...(generationParams ? { generationParams } : {}),
    };
};

export const 获取酒馆预设角色ID列表 = (preset: 酒馆预设结构 | null | undefined): number[] => {
    if (!preset || !Array.isArray(preset.prompt_order)) return [];
    return Array.from(new Set(preset.prompt_order.map((item) => item.character_id)));
};

export const 获取酒馆预设顺序 = (
    preset: 酒馆预设结构 | null | undefined,
    selectedCharacterId?: number | null
): 酒馆预设顺序结构 | null => {
    if (!preset || !Array.isArray(preset.prompt_order) || preset.prompt_order.length === 0) return null;
    const normalizedId = typeof selectedCharacterId === 'number' && Number.isFinite(selectedCharacterId)
        ? Math.floor(selectedCharacterId)
        : null;
    if (normalizedId !== null) {
        const matched = preset.prompt_order.find((item) => item.character_id === normalizedId);
        if (matched) return matched;
    }
    const preferredDefault = preset.prompt_order.find((item) => item.character_id === 100001);
    if (preferredDefault) return preferredDefault;
    return preset.prompt_order[0] || null;
};

// ─── 便捷：获取预设中可安全执行的正则脚本 ───

/**
 * 获取预设中已分类的正则脚本列表
 * 供响应管道调用
 */
export const 获取预设已分类正则脚本 = (
    preset: 酒馆预设结构 | null | undefined
): 酒馆正则脚本分类条目[] => {
    if (!preset?.兼容性?.已分类脚本列表) {
        return 提取并分类正则脚本(preset?.extensions as Record<string, unknown> | undefined);
    }
    return preset.兼容性.已分类脚本列表;
};
