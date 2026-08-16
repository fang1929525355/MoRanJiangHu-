import { tryDbBucket } from '../_shared/dbStore';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

const WORKSHOP_PREFIX = 'moranjianghu/workshop/modules';
const MAX_MODULE_BYTES = 2 * 1024 * 1024;
const CHINA_TIMEZONE_OFFSET_MS = 8 * 60 * 60 * 1000;
const encoder = new TextEncoder();

type WorkshopModuleEntry = {
    id: string;
    type: 'topic' | 'world_rules' | 'opening' | 'ability' | 'comfy_workflow' | 'tavern_preset';
    formatVersion?: number;
    workshopKind?: 'standard_module';
    title: string;
    subtitle: string;
    description: string;
    tags: string[];
    payload: Record<string, unknown>;
    worldDetailGeneration?: Record<string, unknown>;
    modeRuntimeProfile?: Record<string, unknown>;
    modeWorldbooks?: unknown[];
    contentBlocks?: Array<{
        id: string;
        title: string;
        purpose: string;
        content: string;
        injectionTarget?: 'manualWorldPrompt' | 'worldExtraRequirement' | 'manualRealmPrompt' | 'openingExtraRequirement' | 'imageWorkflow' | 'referenceOnly';
    }>;
    usagePrompt?: string;
    safetyNotes?: string[];
    injectionPreview: string[];
    preset?: unknown;
    tavernPreset?: unknown;
    contributor: string;
    createdAt: string;
    updatedAt: string;
    version?: number;
    baseModuleId?: string;
    versionNote?: string;
    sha256: string;
    r2Key: string;
    ownerUserId?: string;
    ownerUsername?: string;
    anonymous?: boolean;
};

type CloudPlayUser = {
    userId: string;
    username: string;
    usernameKey: string;
    passwordSalt: string;
    passwordHash: string;
};

const jsonResponse = (payload: unknown, status = 200): Response => (
    new Response(JSON.stringify(payload), {
        status,
        headers: { ...JSON_HEADERS, ...CORS_HEADERS, 'Cache-Control': 'no-store' }
    })
);

const readString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const readPlainObject = (value: unknown): Record<string, unknown> | undefined => (
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
);

const getBucket = (env: any): any => {
    const dbBucket = tryDbBucket(env, 'workshop_data');
    if (dbBucket) return dbBucket;
    const candidate = env?.WORKSHOP_R2 || env?.CNB_SYNC_R2;
    if (!candidate || typeof candidate.get !== 'function' || typeof candidate.put !== 'function') return null;
    return candidate;
};

/** Auth bucket reads from the same store as cloud-play user registration. */
const getAuthBucket = (env: any): any => {
    const dbBucket = tryDbBucket(env, 'cloud_play_data');
    if (dbBucket) return dbBucket;
    const candidate = env?.CLOUD_PLAY_R2 || env?.CNB_SYNC_R2;
    if (!candidate || typeof candidate.get !== 'function' || typeof candidate.put !== 'function') return null;
    return candidate;
};

const getPrefix = (env: any): string => (
    readString(env?.WORKSHOP_MODULES_PREFIX) || WORKSHOP_PREFIX
).replace(/^\/+|\/+$/g, '') || WORKSHOP_PREFIX;

const bytesToHex = (bytes: ArrayBuffer): string => (
    Array.from(new Uint8Array(bytes)).map((item) => item.toString(16).padStart(2, '0')).join('')
);

const sha256HexText = async (value: string): Promise<string> => (
    bytesToHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
);

const hmacHex = async (secret: string, value: string): Promise<string> => {
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return bytesToHex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
};

const timingSafeEqual = (a: string, b: string): boolean => {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
    return diff === 0;
};

const sortValue = (value: unknown): unknown => {
    if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(sortValue);
    if (value && typeof value === 'object') {
        return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((acc, key) => {
            const sorted = sortValue((value as Record<string, unknown>)[key]);
            if (sorted !== undefined) acc[key] = sorted;
            return acc;
        }, {});
    }
    return null;
};

const normalizeFingerprintText = (value: unknown): string => String(value ?? '').trim().replace(/\s+/g, ' ');

const normalizeFingerprintList = (value: unknown): string[] => (
    Array.isArray(value) ? value.map(normalizeFingerprintText).filter(Boolean) : []
);

const buildContentFingerprint = (entry: Pick<WorkshopModuleEntry, 'type' | 'title' | 'subtitle' | 'description' | 'tags' | 'payload' | 'injectionPreview' | 'preset' | 'contentBlocks' | 'usagePrompt' | 'safetyNotes'>): string => (
    JSON.stringify(sortValue({
        type: entry.type,
        title: normalizeFingerprintText(entry.title),
        subtitle: normalizeFingerprintText(entry.subtitle),
        description: normalizeFingerprintText(entry.description),
        tags: normalizeFingerprintList(entry.tags),
        payload: entry.payload || {},
        contentBlocks: entry.contentBlocks || [],
        usagePrompt: normalizeFingerprintText(entry.usagePrompt),
        safetyNotes: normalizeFingerprintList(entry.safetyNotes),
        injectionPreview: normalizeFingerprintList(entry.injectionPreview),
        preset: entry.preset || null
    }))
);

const sanitizeText = (value: unknown, maxLength: number): string => readString(value).replace(/\s+/g, ' ').slice(0, maxLength);

const sanitizeTags = (value: unknown): string[] => (
    Array.isArray(value) ? value.map((item) => sanitizeText(item, 20)).filter(Boolean).slice(0, 12) : []
);

const sanitizeContentBlocks = (value: unknown): WorkshopModuleEntry['contentBlocks'] => (
    Array.isArray(value)
        ? value.map((block: any) => {
            const injectionTarget = block?.injectionTarget;
            return {
                ...block,
                id: sanitizeText(block?.id, 60),
                title: sanitizeText(block?.title, 80),
                purpose: sanitizeText(block?.purpose, 200),
                content: readString(block?.content).slice(0, 20000),
                injectionTarget: injectionTarget === 'manualWorldPrompt' || injectionTarget === 'worldExtraRequirement' || injectionTarget === 'manualRealmPrompt' || injectionTarget === 'openingExtraRequirement' || injectionTarget === 'imageWorkflow' || injectionTarget === 'referenceOnly'
                    ? injectionTarget
                    : undefined
            };
        }).filter((block) => block.id && block.title && block.content).slice(0, 24)
        : undefined
);

const normalizeType = (value: unknown): WorkshopModuleEntry['type'] | '' => (
    value === 'topic' || value === 'world_rules' || value === 'opening' || value === 'ability' || value === 'comfy_workflow' || value === 'tavern_preset' ? value : ''
);

const buildId = (type: string): string => {
    const random = crypto.getRandomValues(new Uint8Array(5));
    const suffix = Array.from(random).map((byte) => byte.toString(36).padStart(2, '0')).join('').slice(0, 8).toUpperCase();
    const stamp = new Date(Date.now() + CHINA_TIMEZONE_OFFSET_MS).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    return `CWM-${type.toUpperCase()}-${stamp}-${suffix}`;
};

const getCloudPlayPrefix = (env: any): string => (
    readString(env?.CLOUD_PLAY_R2_PREFIX) || 'moranjianghu/cloud-play'
).replace(/^\/+|\/+$/g, '') || 'moranjianghu/cloud-play';

const sanitizeUsername = (value: unknown): string => {
    const username = readString(value).replace(/\s+/g, '');
    if (username.length < 3 || username.length > 32) throw new Error('请先用有效联机用户名登录。');
    if (!/^[\p{L}\p{N}_-]+$/u.test(username)) throw new Error('联机用户名格式无效。');
    return username;
};

const sanitizePassword = (value: unknown): string => {
    const password = typeof value === 'string' ? value : '';
    if (password.length < 6 || password.length > 128) throw new Error('请先用有效联机密码登录。');
    return password;
};

const authenticateWorkshopUser = async (env: any, auth: any): Promise<CloudPlayUser> => {
    const bucket = getAuthBucket(env);
    if (!bucket) throw new Error('创意工坊存储未配置');
    const username = sanitizeUsername(auth?.username);
    const password = sanitizePassword(auth?.password);
    const usernameKey = await sha256HexText(username.toLowerCase());
    const object = await bucket.get(`${getCloudPlayPrefix(env)}/users/${usernameKey}.json`);
    if (!object) throw new Error('请先登录联机账号后再管理创意工坊投稿。');
    const user = await object.json().catch(() => null) as CloudPlayUser | null;
    if (!user?.passwordSalt || !user.passwordHash) throw new Error('账号数据损坏。');
    const passwordHash = await hmacHex(user.passwordSalt, `${usernameKey}\n${password}`);
    if (!timingSafeEqual(passwordHash, user.passwordHash)) throw new Error('联机账号或密码错误。');
    return user;
};

const requireOwner = (entry: WorkshopModuleEntry, user: CloudPlayUser): void => {
    if (!entry.ownerUserId) throw new Error('旧版匿名投稿暂不支持在线编辑或删除。');
    if (entry.ownerUserId !== user.userId) throw new Error('只能编辑或删除自己的投稿。');
};

const buildKeys = (env: any, id: string) => {
    const prefix = getPrefix(env);
    return {
        moduleKey: `${prefix}/entries/${id}.json`,
        indexKey: `${prefix}/index/latest.json`
    };
};

const getIndexEntriesPrefix = (env: any): string => `${getPrefix(env)}/index/entries/`;
const getIndexEntryKey = (env: any, id: string): string => `${getIndexEntriesPrefix(env)}${id}.json`;

const readIndex = async (env: any): Promise<{ entries: WorkshopModuleEntry[]; warning?: string }> => {
    const bucket = getBucket(env);
    if (!bucket) {
        console.error('[workshop] storage bucket unavailable — returning empty list');
        return { entries: [], warning: '创意工坊存储未配置，列表可能不完整。' };
    }
    const legacyObject = await bucket.get(`${getPrefix(env)}/index/latest.json`);
    const legacyParsed = legacyObject ? await legacyObject.json().catch(() => null) as { entries?: WorkshopModuleEntry[] } | null : null;
    if (legacyObject && !legacyParsed) {
        console.error('[workshop] legacy index/latest.json is unreadable (orphan/corrupt chunk manifest)');
    }
    const entries = new Map<string, WorkshopModuleEntry>((Array.isArray(legacyParsed?.entries) ? legacyParsed.entries : []).map((entry) => [entry.id, entry]));
    if (typeof bucket.list !== 'function') return { entries: Array.from(entries.values()) };
    let cursor: string | undefined;
    let listFailures = 0;
    let corruptDeltas = 0;
    do {
        const listed = await bucket.list({ prefix: getIndexEntriesPrefix(env), cursor, limit: 1000 }).catch((error: unknown) => {
            listFailures += 1;
            console.error('[workshop] index delta list failed:', error);
            return null;
        });
        if (!listed || !Array.isArray(listed.objects)) break;
        const keys = listed.objects.map((object: any) => object?.key).filter((key: unknown): key is string => typeof key === 'string');
        for (let offset = 0; offset < keys.length; offset += 50) {
            const pageKeys = keys.slice(offset, offset + 50);
            const objects = await Promise.all(pageKeys.map((key) => bucket.get(key)));
            for (let i = 0; i < objects.length; i++) {
                const object = objects[i];
                const delta = object ? await object.json().catch(() => null) as { id?: string; deleted?: boolean; entry?: WorkshopModuleEntry } | null : null;
                if (!delta?.id) {
                    if (object) {
                        corruptDeltas += 1;
                        console.error('[workshop] index delta row is corrupt and was skipped:', pageKeys[i]);
                    }
                    continue;
                }
                if (delta.deleted) entries.delete(delta.id);
                else if (delta.entry) entries.set(delta.id, delta.entry);
            }
        }
        cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
    const warnings: string[] = [];
    if (legacyObject && !legacyParsed) warnings.push('工坊主索引读取失败，仅显示增量数据。');
    if (listFailures > 0) warnings.push('工坊增量索引读取失败，最新投稿可能未显示。');
    if (corruptDeltas > 0) warnings.push(`有 ${corruptDeltas} 条投稿索引记录损坏被跳过。`);
    return {
        entries: Array.from(entries.values()).sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt))).slice(0, 500),
        warning: warnings.length > 0 ? warnings.join(' ') : undefined
    };
};

const upsertIndexEntry = async (env: any, entry: WorkshopModuleEntry): Promise<void> => {
    const bucket = getBucket(env);
    if (!bucket) throw new Error('创意工坊存储未配置');
    await bucket.put(getIndexEntryKey(env, entry.id), JSON.stringify({ id: entry.id, entry }), {
        httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' }
    });
};

const deleteIndexEntry = async (env: any, id: string): Promise<void> => {
    const bucket = getBucket(env);
    if (!bucket) throw new Error('创意工坊存储未配置');
    await bucket.put(getIndexEntryKey(env, id), JSON.stringify({ id, deleted: true }), {
        httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-store' }
    });
};

const normalizeModule = async (raw: any, contributorInput = '', owner?: CloudPlayUser, anonymous = false): Promise<WorkshopModuleEntry> => {
    const module = raw?.module && typeof raw.module === 'object' ? raw.module : raw;
    const type = normalizeType(module?.type);
    if (!type) throw new Error('模块类型不支持');
    const title = sanitizeText(module?.title, 80);
    if (!title) throw new Error('模块标题不能为空');
    const createdAt = new Date().toISOString();
    const id = buildId(type);
    const payload = readPlainObject(module?.payload) || {};
    const worldDetailGeneration = readPlainObject(module?.worldDetailGeneration) || readPlainObject((payload as any).worldDetailGeneration);
    const modeRuntimeProfile = readPlainObject(module?.modeRuntimeProfile) || readPlainObject((payload as any).modeRuntimeProfile);
    const modeWorldbooks = Array.isArray(module?.modeWorldbooks)
        ? module.modeWorldbooks
        : Array.isArray((payload as any).modeWorldbooks)
            ? (payload as any).modeWorldbooks
            : undefined;
    const packagePart = readString((payload as any).packagePart);
    if ((packagePart === 'topic' || packagePart === 'world_rules' || packagePart === 'ability') && !readString((payload as any).suiteId)) {
        throw new Error('分段模式包必须携带 suiteId；普通标准模块请不要设置 packagePart。');
    }
    const entry: Omit<WorkshopModuleEntry, 'sha256' | 'r2Key'> = {
        id,
        type,
        title,
        subtitle: sanitizeText(module?.subtitle, 100),
        description: sanitizeText(module?.description, 500),
        tags: sanitizeTags(module?.tags),
        payload,
        worldDetailGeneration,
        modeRuntimeProfile,
        modeWorldbooks,
        formatVersion: Number(module?.formatVersion) === 2 ? 2 : undefined,
        workshopKind: module?.workshopKind === 'standard_module' ? 'standard_module' : undefined,
        contentBlocks: sanitizeContentBlocks(module?.contentBlocks),
        usagePrompt: sanitizeText(module?.usagePrompt, 500),
        safetyNotes: Array.isArray(module?.safetyNotes) ? module.safetyNotes.map((item: unknown) => sanitizeText(item, 200)).filter(Boolean).slice(0, 12) : [],
        injectionPreview: Array.isArray(module?.injectionPreview) ? module.injectionPreview.map((item: unknown) => sanitizeText(item, 400)).filter(Boolean).slice(0, 12) : [],
        preset: module?.preset && typeof module.preset === 'object' ? module.preset : undefined,
        tavernPreset: module?.tavernPreset && typeof module.tavernPreset === 'object'
            ? module.tavernPreset
            : (payload as any)?.tavernPreset && typeof (payload as any).tavernPreset === 'object'
                ? (payload as any).tavernPreset
                : undefined,
        contributor: anonymous ? '匿名玩家' : (sanitizeText(contributorInput || module?.contributor, 40) || owner?.username || '匿名玩家'),
        createdAt,
        updatedAt: createdAt,
        version: Number.isInteger(Number(module?.version)) && Number(module.version) > 0 ? Number(module.version) : 1,
        baseModuleId: sanitizeText(module?.baseModuleId || (payload as any).suiteId, 120) || undefined,
        versionNote: sanitizeText(module?.versionNote, 200),
        ownerUserId: owner?.userId,
        ownerUsername: owner?.username,
        anonymous
    };
    const json = JSON.stringify(entry);
    if (encoder.encode(json).byteLength > MAX_MODULE_BYTES) throw new Error('模块 JSON 过大，请控制在 2MB 内');
    const keys = buildKeys({}, id);
    return { ...entry, sha256: await sha256HexText(json), r2Key: keys.moduleKey };
};

const sanitizeUpdatedModule = async (
    target: WorkshopModuleEntry,
    patch: any,
    user: CloudPlayUser,
    anonymous: boolean
): Promise<WorkshopModuleEntry> => {
    const modulePatch = patch?.module && typeof patch.module === 'object' && !Array.isArray(patch.module)
        ? patch.module
        : {};
    const payload = readPlainObject(modulePatch.payload) || target.payload;
    const worldDetailGeneration = readPlainObject(modulePatch.worldDetailGeneration)
        || readPlainObject((payload as any).worldDetailGeneration)
        || target.worldDetailGeneration;
    const modeRuntimeProfile = readPlainObject(modulePatch.modeRuntimeProfile)
        || readPlainObject((payload as any).modeRuntimeProfile)
        || target.modeRuntimeProfile;
    const modeWorldbooks = Array.isArray(modulePatch.modeWorldbooks)
        ? modulePatch.modeWorldbooks
        : Array.isArray((payload as any).modeWorldbooks)
            ? (payload as any).modeWorldbooks
            : target.modeWorldbooks;
    const contentBlocks = Array.isArray(modulePatch.contentBlocks)
        ? sanitizeContentBlocks(modulePatch.contentBlocks)
        : target.contentBlocks;
    const updatedWithoutSha: Omit<WorkshopModuleEntry, 'sha256'> = {
        ...target,
        title: sanitizeText(patch.title, 80) || sanitizeText(modulePatch.title, 80) || target.title,
        subtitle: sanitizeText(patch.subtitle, 100) || sanitizeText(modulePatch.subtitle, 100) || target.subtitle,
        description: sanitizeText(patch.description, 500) || sanitizeText(modulePatch.description, 500) || target.description,
        tags: Array.isArray(patch.tags)
            ? sanitizeTags(patch.tags)
            : Array.isArray(modulePatch.tags)
                ? sanitizeTags(modulePatch.tags)
                : target.tags,
        payload,
        worldDetailGeneration,
        modeRuntimeProfile,
        modeWorldbooks,
        formatVersion: Number(modulePatch.formatVersion) === 2 ? 2 : target.formatVersion,
        workshopKind: modulePatch.workshopKind === 'standard_module' ? 'standard_module' : target.workshopKind,
        contentBlocks,
        usagePrompt: typeof modulePatch.usagePrompt === 'string' ? sanitizeText(modulePatch.usagePrompt, 500) : target.usagePrompt,
        safetyNotes: Array.isArray(modulePatch.safetyNotes)
            ? modulePatch.safetyNotes.map((item: unknown) => sanitizeText(item, 200)).filter(Boolean).slice(0, 12)
            : target.safetyNotes,
        injectionPreview: Array.isArray(modulePatch.injectionPreview)
            ? modulePatch.injectionPreview.map((item: unknown) => sanitizeText(item, 400)).filter(Boolean).slice(0, 12)
            : target.injectionPreview,
        preset: modulePatch.preset && typeof modulePatch.preset === 'object' ? modulePatch.preset : target.preset,
        tavernPreset: modulePatch.tavernPreset && typeof modulePatch.tavernPreset === 'object'
            ? modulePatch.tavernPreset
            : (payload as any)?.tavernPreset && typeof (payload as any).tavernPreset === 'object'
                ? (payload as any).tavernPreset
                : target.tavernPreset,
        contributor: anonymous ? '匿名玩家' : (sanitizeText(patch.contributor, 40) || sanitizeText(modulePatch.contributor, 40) || user.username),
        anonymous,
        ownerUserId: target.ownerUserId,
        ownerUsername: target.ownerUsername,
        createdAt: target.createdAt,
        updatedAt: new Date().toISOString(),
        version: target.version,
        baseModuleId: target.baseModuleId,
        versionNote: typeof modulePatch.versionNote === 'string' ? sanitizeText(modulePatch.versionNote, 200) : target.versionNote,
        r2Key: target.r2Key
    };
    const json = JSON.stringify(updatedWithoutSha);
    if (encoder.encode(json).byteLength > MAX_MODULE_BYTES) throw new Error('模块 JSON 过大，请控制在 2MB 内');
    return {
        ...updatedWithoutSha,
        sha256: await sha256HexText(json)
    };
};

export function onRequestOptions(): Response {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet({ request, env }: any): Promise<Response> {
    try {
        const url = new URL(request.url);
        const action = readString(url.searchParams.get('action'));
        const { entries, warning } = await readIndex(env);
        if (action === 'download') {
            const id = readString(url.searchParams.get('id'));
            const entry = entries.find((item) => item.id === id);
            if (!entry) return jsonResponse({ error: '未找到该创意工坊模块' }, 404);
            return jsonResponse({ ok: true, module: entry });
        }
        return jsonResponse({ ok: true, entries, warning });
    } catch (error: any) {
        return jsonResponse({ error: error?.message || '读取创意工坊失败' }, 500);
    }
}

export async function onRequestPost({ request, env }: any): Promise<Response> {
    try {
        const bucket = getBucket(env);
        if (!bucket) return jsonResponse({ error: '创意工坊存储未配置' }, 500);
        const body = await request.json();
        const action = readString(body?.action) || 'create';
        const { entries: existingEntries } = await readIndex(env);

        if (action === 'update' || action === 'delete') {
            const user = await authenticateWorkshopUser(env, body?.auth);
            const id = readString(body?.id);
            const target = existingEntries.find((item) => item.id === id);
            if (!target) return jsonResponse({ ok: false, error: '未找到该创意工坊模块' }, 404);
            requireOwner(target, user);
            if (action === 'delete') {
                await deleteIndexEntry(env, id);
                if (typeof bucket.delete === 'function') await bucket.delete(target.r2Key);
                return jsonResponse({ ok: true, deleted: true });
            }
            const patch = body?.patch && typeof body.patch === 'object' ? body.patch : {};
            const anonymous = body?.anonymous === true;
            const updated = await sanitizeUpdatedModule(target, patch, user, anonymous);
            await bucket.put(updated.r2Key, JSON.stringify(updated, null, 2), {
                httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'public, max-age=300' },
                customMetadata: { sha256: updated.sha256, workshopId: updated.id }
            });
            await upsertIndexEntry(env, updated);
            return jsonResponse({ ok: true, entry: updated });
        }

        const owner = await authenticateWorkshopUser(env, body?.auth);
        const entry = await normalizeModule(body, body?.contributor, owner, body?.anonymous === true);
        const requestedBaseId = entry.baseModuleId;
        const ownedRequestedChain = requestedBaseId
            ? existingEntries.filter((item) => item.baseModuleId === requestedBaseId && item.ownerUserId === owner.userId)
            : [];
        const ownedTitleChain = existingEntries.filter((item) => item.ownerUserId === owner.userId && item.title === entry.title);
        const ownedChain = ownedRequestedChain.length > 0 ? ownedRequestedChain : ownedTitleChain;
        const baseModuleId = ownedChain[0]?.baseModuleId || entry.id;
        const version = ownedChain.length > 0 ? Math.max(...ownedChain.map((item) => Number(item.version) || 1)) + 1 : 1;
        const keys = buildKeys(env, entry.id);
        const finalEntry = { ...entry, baseModuleId, version, r2Key: keys.moduleKey };
        const fingerprint = buildContentFingerprint(finalEntry);
        const officialFingerprints = Array.isArray(body?.officialFingerprints) ? body.officialFingerprints.filter((item: unknown) => typeof item === 'string') : [];
        if (officialFingerprints.includes(fingerprint)) {
            return jsonResponse({ ok: false, error: '该模块与官方预设完全一致，无需重复贡献社区。' }, 409);
        }
        if (existingEntries.some((item) => buildContentFingerprint(item) === fingerprint)) {
            return jsonResponse({ ok: false, error: '社区工坊已存在内容完全相同的模块。' }, 409);
        }
        await bucket.put(keys.moduleKey, JSON.stringify(finalEntry, null, 2), {
            httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'public, max-age=300' },
            customMetadata: { sha256: finalEntry.sha256, workshopId: finalEntry.id }
        });
        await upsertIndexEntry(env, finalEntry);
        return jsonResponse({
            ok: true,
            entry: finalEntry,
            downloadUrl: `/api/workshop/modules?action=download&id=${encodeURIComponent(finalEntry.id)}`
        });
    } catch (error: any) {
        return jsonResponse({ error: error?.message || '发布创意工坊失败' }, 500);
    }
}
