import type {
    RealmDiyDraft,
    RealmDiyRow,
    RealmDiySystem,
    RealmDiySystemRole,
    WorldGenConfig,
    WorldMapDiyDraft,
    WorldMapDiyFeature,
    WorldMapDiyFeatureType,
    WorldMapDiyGeometry,
    WorldMapDiyLayerType,
    WorldMapDiyNode,
    WorldMapDiyPoint,
    WorldMapDiyScaleFields,
} from '../types';

const LAYER_ORDER: WorldMapDiyLayerType[] = ['寰宇', '大地点', '中地点', '小地点', '区地点', '子地点'];

export const 世界地图DIY层级选项: Array<{ value: WorldMapDiyLayerType; label: string; hint: string }> = [
    { value: '寰宇', label: '宇宙/位面', hint: '多元宇宙、位面群、世界根节点' },
    { value: '大地点', label: '星球/世界', hint: '独立世界、星球、主世界' },
    { value: '中地点', label: '大陆/板块', hint: '大陆、海域、国家级区域' },
    { value: '小地点', label: '国家/区域', hint: '国家、州郡、城市、聚落' },
    { value: '区地点', label: '城市/地点/建筑', hint: '城市片区、建筑、地标、秘境入口' },
    { value: '子地点', label: '场景/房间', hint: '室内房间、洞府内层、局部场景' },
];

export const 世界地图DIY要素标签: Record<WorldMapDiyFeatureType, string> = {
    mountain: '山脉/地貌',
    river: '河流/水系',
    road: '道路/商路',
    waterway: '水路/航线',
    route: '交通网络',
    portal: '传送/灵脉',
};

const 交通水系类型 = new Set<WorldMapDiyFeatureType>(['river', 'road', 'waterway', 'route', 'portal']);

export const createDiyId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizePoint = (point: Partial<WorldMapDiyPoint> | undefined, fallback: WorldMapDiyPoint): WorldMapDiyPoint => {
    const x = Number(point?.x);
    const y = Number(point?.y);
    return {
        x: Number.isFinite(x) ? Math.round(x * 100) / 100 : fallback.x,
        y: Number.isFinite(y) ? Math.round(y * 100) / 100 : fallback.y,
    };
};

const normalizeGeometry = (geometry: Partial<WorldMapDiyGeometry> | undefined, fallbackType: WorldMapDiyGeometry['type']): WorldMapDiyGeometry => {
    const type = geometry?.type === 'point' || geometry?.type === 'polygon' ? geometry.type : fallbackType;
    const rawPoints = Array.isArray(geometry?.points) ? geometry!.points : [];
    const points = rawPoints
        .map((point, index) => normalizePoint(point, { x: 160 + index * 24, y: 160 + index * 16 }))
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (type === 'point') {
        return { type, points: [points[0] || { x: 260, y: 220 }] };
    }
    return {
        type,
        points: points.length >= 3 ? points : [
            { x: 180, y: 180 },
            { x: 320, y: 160 },
            { x: 360, y: 280 },
            { x: 220, y: 310 },
        ],
        closed: geometry?.closed !== false,
    };
};

const normalizeScaleFields = (fields: Partial<WorldMapDiyScaleFields> | undefined): WorldMapDiyScaleFields => {
    const result: WorldMapDiyScaleFields = {};
    Object.entries(fields || {}).forEach(([key, value]) => {
        const normalized = text(value);
        if (normalized) (result as Record<string, string>)[key] = normalized;
    });
    return result;
};

const normalizeTags = (tags: unknown): string[] => (
    Array.isArray(tags)
        ? tags.map((item) => text(item)).filter(Boolean).slice(0, 12)
        : []
);

export const createEmptyRealmDraft = (): RealmDiyDraft => {
    const rows: RealmDiyRow[] = [
        {
            id: createDiyId('realm'),
            name: '开脉',
            level: 1,
            power: '入门',
            breakthrough: '以启蒙为主',
            parameters: '寿元、内力、灵力、神识可由 AI 补完',
            description: 'AI 补完描述'
        }
    ];
    return {
        systems: [{
            id: createDiyId('realm_system'),
            name: '默认体系',
            description: '',
            energyType: '',
            role: 'primary_or_secondary',
            rows
        }],
        rows,
        updatedAt: Date.now()
    };
};

export const createEmptyWorldMapDraft = (): WorldMapDiyDraft => ({
    enabled: false,
    nodes: [
        {
            id: createDiyId('map'),
            name: '诸天万界',
            layer: '寰宇',
            parentId: '',
            description: '世界总根节点',
            geometry: {
                type: 'point',
                points: [{ x: 120, y: 120 }],
            },
        }
    ],
    features: [],
    canvas: { width: 1600, height: 1000, zoom: 1, panX: 0, panY: 0 },
    referenceOpacity: 0.35,
    referenceTransform: { x: 0, y: 0, scale: 1, rotation: 0, locked: true },
    updatedAt: Date.now()
});

const realmSystemRoles = new Set<RealmDiySystemRole>(['primary_or_secondary', 'primary_only', 'secondary_only']);

export const normalizeRealmSystem = (system: Partial<RealmDiySystem> | undefined, index: number): RealmDiySystem => {
    const fallbackRows = createEmptyRealmDraft().rows || [];
    return {
        id: text(system?.id) || createDiyId(`realm_system_${index}`),
        name: text(system?.name) || `能力体系${index + 1}`,
        description: text(system?.description),
        energyType: text(system?.energyType),
        role: realmSystemRoles.has(system?.role as RealmDiySystemRole) ? system!.role! : 'primary_or_secondary',
        rows: Array.isArray(system?.rows) && system.rows.length > 0
            ? system.rows.map((row, rowIndex) => normalizeRealmRow(row, rowIndex))
            : fallbackRows.map((row, rowIndex) => normalizeRealmRow(row, rowIndex))
    };
};

export const normalizeRealmDraft = (draft?: RealmDiyDraft | null): RealmDiyDraft => {
    const emptyRows = createEmptyRealmDraft().rows || [];
    const legacyRows = Array.isArray(draft?.rows) && draft.rows.length > 0
        ? draft.rows.map((row, index) => normalizeRealmRow(row, index))
        : emptyRows;
    const systems = Array.isArray(draft?.systems) && draft.systems.length > 0
        ? draft.systems.map((system, index) => normalizeRealmSystem(system, index))
        : [{
            id: createDiyId('realm_system_default'),
            name: '默认体系',
            description: '',
            energyType: '',
            role: 'primary_or_secondary' as const,
            rows: legacyRows
        }];
    const compatibilitySystem = systems.find((system) => system.role !== 'secondary_only') || systems[0];
    return {
        systems,
        rows: compatibilitySystem.rows,
        updatedAt: Date.now()
    };
};

export const normalizeWorldMapDraft = (draft?: WorldMapDiyDraft | null): WorldMapDiyDraft => {
    const empty = createEmptyWorldMapDraft();
    const nodes = Array.isArray(draft?.nodes) && draft.nodes.length > 0
        ? draft.nodes.map((node, index) => normalizeWorldMapNode(node, index))
        : empty.nodes;
    const canvasWidth = Number(draft?.canvas?.width);
    const canvasHeight = Number(draft?.canvas?.height);
    const referenceScale = Number(draft?.referenceTransform?.scale);
    const referenceRotation = Number(draft?.referenceTransform?.rotation);
    return {
        enabled: draft?.enabled === true,
        nodes,
        features: Array.isArray(draft?.features)
            ? draft.features.map((feature, index) => normalizeWorldMapFeature(feature, index)).filter((feature) => feature.points.length > 0)
            : [],
        canvas: {
            width: Number.isFinite(canvasWidth) ? clamp(Math.round(canvasWidth), 600, 8000) : empty.canvas!.width,
            height: Number.isFinite(canvasHeight) ? clamp(Math.round(canvasHeight), 400, 8000) : empty.canvas!.height,
            zoom: Number.isFinite(Number(draft?.canvas?.zoom)) ? clamp(Number(draft?.canvas?.zoom), 0.25, 4) : 1,
            panX: Number.isFinite(Number(draft?.canvas?.panX)) ? Number(draft?.canvas?.panX) : 0,
            panY: Number.isFinite(Number(draft?.canvas?.panY)) ? Number(draft?.canvas?.panY) : 0,
        },
        referenceImage: text(draft?.referenceImage),
        referenceOpacity: typeof draft?.referenceOpacity === 'number' ? clamp(draft.referenceOpacity, 0, 1) : 0.35,
        referenceTransform: {
            x: Number.isFinite(Number(draft?.referenceTransform?.x)) ? Number(draft?.referenceTransform?.x) : 0,
            y: Number.isFinite(Number(draft?.referenceTransform?.y)) ? Number(draft?.referenceTransform?.y) : 0,
            scale: Number.isFinite(referenceScale) ? clamp(referenceScale, 0.1, 5) : 1,
            rotation: Number.isFinite(referenceRotation) ? clamp(referenceRotation, -180, 180) : 0,
            locked: draft?.referenceTransform?.locked !== false,
        },
        updatedAt: Date.now()
    };
};

export const normalizeRealmRow = (row: Partial<RealmDiyRow> | undefined, index: number): RealmDiyRow => ({
    id: text(row?.id) || createDiyId(`realm_row_${index}`),
    name: text(row?.name),
    level: Number.isFinite(Number(row?.level)) ? Math.max(1, Math.round(Number(row?.level))) : index + 1,
    power: text(row?.power),
    breakthrough: text(row?.breakthrough),
    parameters: text(row?.parameters),
    description: text(row?.description)
});

export const normalizeWorldMapNode = (node: Partial<WorldMapDiyNode> | undefined, index: number): WorldMapDiyNode => {
    const layer = LAYER_ORDER.includes(node?.layer as WorldMapDiyLayerType) ? node!.layer! : '小地点';
    const geometryType = layer === '区地点' || layer === '子地点' ? 'point' : 'polygon';
    const scaleFields = normalizeScaleFields(node?.scaleFields);
    const narrativeCore = text(node?.narrativeCore) || text((scaleFields as any).narrativeCore);
    return {
        id: text(node?.id) || createDiyId(`map_node_${index}`),
        name: text(node?.name),
        layer,
        parentId: text(node?.parentId),
        description: text(node?.description),
        climate: text(node?.climate),
        population: text(node?.population),
        culture: text(node?.culture),
        transport: text(node?.transport),
        narrativeCore,
        geometry: normalizeGeometry(node?.geometry, geometryType),
        scaleFields: narrativeCore ? { ...scaleFields, narrativeCore } : scaleFields,
        tags: normalizeTags(node?.tags),
    };
};

export const normalizeWorldMapFeature = (feature: Partial<WorldMapDiyFeature> | undefined, index: number): WorldMapDiyFeature => {
    const type = (['mountain', 'river', 'road', 'waterway', 'route', 'portal'] as const).includes(feature?.type as WorldMapDiyFeatureType)
        ? feature!.type!
        : 'road';
    const rawPoints = Array.isArray(feature?.points) ? feature!.points : [];
    return {
        id: text(feature?.id) || createDiyId(`map_feature_${index}`),
        type,
        name: text(feature?.name),
        parentId: text(feature?.parentId),
        connectedNodeIds: Array.isArray(feature?.connectedNodeIds) ? feature!.connectedNodeIds.map((item) => text(item)).filter(Boolean) : [],
        points: rawPoints.map((point, pointIndex) => normalizePoint(point, { x: 220 + pointIndex * 70, y: 260 + pointIndex * 20 })),
        description: text(feature?.description),
        fields: Object.fromEntries(Object.entries(feature?.fields || {}).map(([key, value]) => [key, text(value)]).filter(([, value]) => value)),
        tags: normalizeTags(feature?.tags),
    };
};

export const buildRealmPromptFromDraft = (draft: RealmDiyDraft): string => {
    const normalized = normalizeRealmDraft(draft);
    const systems = normalized.systems || [];
    const compatibilitySystem = systems.find((system) => system.role !== 'secondary_only') || systems[0];
    const rows = [...(compatibilitySystem?.rows || normalized.rows || [])]
        .filter((row) => row.name.trim())
        .sort((a, b) => a.level - b.level);
    const fallbackRows = rows.length > 0 ? rows : (createEmptyRealmDraft().rows || []);
    const requiredLevels = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 27, 33, 43];
    const majorBreaks = [1, 5, 9, 13, 17, 21, 27, 33, 43];
    const pickRealmForLevel = (level: number): RealmDiyRow => (
        [...fallbackRows].reverse().find((row) => row.level <= level) || fallbackRows[0]
    );
    const labelForLevel = (level: number): string => {
        const exact = fallbackRows.find((row) => row.level === level);
        if (exact?.name) return exact.name;
        const base = pickRealmForLevel(level);
        if (majorBreaks.includes(level)) return base.name || `第${level}阶`;
        const nextBreak = majorBreaks.find((mark) => mark > level) || 44;
        const currentBreak = [...majorBreaks].reverse().find((mark) => mark <= level) || 1;
        const inner = Math.max(1, Math.min(9, level - currentBreak + 1));
        const baseName = base.name || `第${currentBreak}阶`;
        return `${baseName}${inner}段`;
    };
    const summaryLines = fallbackRows.map((row, index) => (
        `${index + 1}. ${row.name || `未命名境界${index + 1}`} | 层级：${row.level} | 战力定位：${row.power || '待补完'} | 突破条件：${row.breakthrough || '待补完'} | 参数：${row.parameters || '待补完'} | 描述：${row.description || 'AI 补完'}`
    ));
    const abilityLines = fallbackRows.map((row) => (
        `  - ${row.name || `第${row.level}阶`}：${row.power || row.description || '保持本境界对应的战斗、感知、移动与资源上限。'}`
    ));
    const stageJumps = ['1→2', '2→3', '3→4', '5→6', '6→7', '7→8', '9→10', '10→11', '11→12', '13→14', '14→15', '15→16', '17→18', '18→19', '19→20', '21→22', '22→24'];
    const breakthroughJumps = ['4→5', '8→9', '12→13', '16→17', '20→21', '24→27', '27→33', '33→43'];
    const systemSections = systems.flatMap((system) => {
        const systemRows = [...system.rows].filter((row) => row.name.trim()).sort((a, b) => a.level - b.level);
        return [
            `【能力体系：${system.name}】`,
            `- 体系用途：${system.role === 'primary_only' ? '仅主体系' : system.role === 'secondary_only' ? '仅副体系' : '可作为主体系或副体系'}`,
            `- 能量类型：${system.energyType || '按世界观定义'}`,
            `- 体系定位：${system.description || '按本体系境界能力边界执行'}`,
            ...systemRows.map((row) => `${row.level} => ${row.name}`),
            ...systemRows.map((row) => `  - ${row.name}：${row.power || row.description || '按当前共通战力档位约束能力上限。'}`),
            ''
        ];
    });
    return [
        '<境界体系>',
        '【境界映射母板】',
        ...requiredLevels.map((level) => `${level} => ${labelForLevel(level)}`),
        '',
        '【多体系共通档位规则】',
        '- 每个角色选择一个主体系，并可拥有零个或多个副体系。',
        '- `境界层级` 表示综合战力档位；各体系自身的境界名称与进度写入 `能力体系.primary/secondary`。',
        '- 相同共通档位表示总体威胁大致可比，同档不等于能力相同；近战、术法、治疗、感知、克制和资源消耗仍按各自体系执行。',
        '- 副体系只提供有限协同与横向能力，不允许把多个体系的档位直接相加。',
        '',
        ...systemSections,
        '【九阶命名与能力边界】',
        `- 九阶命名顺序固定：${majorBreaks.map(labelForLevel).join(' → ')}`,
        '- 境界能力边界：',
        ...abilityLines,
        '',
        '【境界差距口径】',
        '- 同一大境内相邻小阶段可通过功法、装备、地利与经验形成胜负波动；跨大境默认存在明显压制。',
        '- 低境界可凭陷阱、人数、克制、偷袭或代价换取短暂优势，但不能稳定无代价碾压高境界。',
        '',
        '【终点文案】',
        `- 当前体系最高终点为 ${labelForLevel(43)}，若继续成长，先以圆满、沉淀、传承或开辟后续道路承接。`,
        '',
        '【阶段推进表】',
        ...stageJumps.map((jump) => `- ${jump}：同一大境内积累推进，需经验、资源、悟性或剧情契机闭环。`),
        '',
        '【大境突破表】',
        ...breakthroughJumps.map((jump) => `- ${jump}：大境突破，需明确瓶颈、风险、代价、资源或关键事件。`),
        '',
        '【题材硬边界】',
        '- 若本体系属于低武/武侠，能力表现应收束在身体、内息、招式、器械、轻功、医毒、机关与江湖秩序内。',
        '- 若本体系属于修仙/玄幻，可使用灵力、神识、法宝、术法与天劫等设定，但仍必须遵守当前母板的阶段差距和突破代价。',
        '',
        '【DIY境界结构摘要】',
        ...summaryLines,
        '</境界体系>'
    ].join('\n');
};

const geometrySummary = (geometry?: WorldMapDiyGeometry): string => {
    if (!geometry || !Array.isArray(geometry.points) || geometry.points.length === 0) return '';
    if (geometry.type === 'point') {
        const point = geometry.points[0];
        return `中心点约在画布(${Math.round(point.x)},${Math.round(point.y)})`;
    }
    const xs = geometry.points.map((point) => point.x);
    const ys = geometry.points.map((point) => point.y);
    return `轮廓约覆盖画布(${Math.round(Math.min(...xs))},${Math.round(Math.min(...ys))})至(${Math.round(Math.max(...xs))},${Math.round(Math.max(...ys))})，锚点${geometry.points.length}个`;
};

const scaleFieldSummary = (fields?: WorldMapDiyScaleFields): string => {
    const pairs = Object.entries(fields || {})
        .map(([key, value]) => [key, text(value)] as const)
        .filter(([, value]) => value);
    if (pairs.length === 0) return '';
    return pairs.map(([key, value]) => `${key}：${value}`).join('；');
};

const narrativeCoreSummary = (node: WorldMapDiyNode): string => (
    text(node.narrativeCore) || text((node.scaleFields as any)?.narrativeCore)
);

const relatedFeatureSummary = (node: WorldMapDiyNode, features: WorldMapDiyFeature[]): string => {
    const related = features.filter((feature) => feature.parentId === node.id || feature.connectedNodeIds?.includes(node.id));
    if (related.length === 0) return '';
    return related.map((feature) => {
        const fields = Object.entries(feature.fields || {})
            .filter(([, value]) => text(value))
            .map(([key, value]) => `${key}:${value}`)
            .join('，');
        return `${世界地图DIY要素标签[feature.type]}「${feature.name || '未命名'}」${feature.description ? `：${feature.description}` : ''}${fields ? `（${fields}）` : ''}`;
    }).join('；');
};

export const buildWorldMapPromptFromDraft = (draft: WorldMapDiyDraft): string => {
    const normalized = normalizeWorldMapDraft(draft);
    const lines = ['<世界地图DIY>', '【地点树】'];
    normalized.nodes.forEach((node) => {
        lines.push([
            `${node.layer}：${node.name || '未命名'}`,
            `显示层级：${世界地图DIY层级选项.find((item) => item.value === node.layer)?.label || node.layer}`,
            `父级：${node.parentId || '无'}`,
            `描述：${node.description || 'AI 补完'}`,
            `舞台/叙事核心：${narrativeCoreSummary(node) || '待补完'}`,
            `空间：${geometrySummary(node.geometry) || '未绘制'}`,
            `字段：${scaleFieldSummary(node.scaleFields) || '待补完'}`,
            `气候：${node.climate || '待补完'}`,
            `人口：${node.population || '待补完'}`,
            `风土人情：${node.culture || '待补完'}`,
            `交通：${node.transport || '待补完'}`,
            `关联地理：${relatedFeatureSummary(node, normalized.features || []) || '无'}`
        ].join(' | '));
    });
    if ((normalized.features || []).length > 0) {
        lines.push('【连接型地理要素】');
        normalized.features!.forEach((feature) => {
            lines.push([
                `${世界地图DIY要素标签[feature.type]}：${feature.name || '未命名'}`,
                `父级/所在区域：${feature.parentId || (交通水系类型.has(feature.type) ? '全局/跨区域交通水系' : '未指定')}`,
                `连接地点：${(feature.connectedNodeIds || []).join('、') || '未指定'}`,
                `路径点：${feature.points.length}个`,
                交通水系类型.has(feature.type) ? '结构：允许跨区域、分叉、支流或支路；同组分支可拆成多条要素并在说明中标明汇入/分叉关系' : '',
                `说明：${feature.description || '待补完'}`,
                `参数：${Object.entries(feature.fields || {}).map(([key, value]) => `${key}:${value}`).join('；') || '待补完'}`
            ].filter(Boolean).join(' | '));
        });
    }
    lines.push('</世界地图DIY>');
    return lines.join('\n');
};

export const buildWorldMapLayersFromDraft = (draft: WorldMapDiyDraft): any[] => {
    const normalized = normalizeWorldMapDraft(draft);
    if (!normalized.enabled) return [];
    return normalized.nodes
        .filter((node) => node.name.trim())
        .map((node) => ({
            ID: node.id,
            名称: node.name,
            层级: node.layer,
            描述: [
                node.description,
                narrativeCoreSummary(node) ? `舞台/叙事核心：${narrativeCoreSummary(node)}` : '',
                geometrySummary(node.geometry),
                node.climate ? `气候：${node.climate}` : '',
                node.population ? `人口：${node.population}` : '',
                node.culture ? `风土：${node.culture}` : '',
                node.transport ? `交通：${node.transport}` : '',
                scaleFieldSummary(node.scaleFields),
                relatedFeatureSummary(node, normalized.features || []),
                node.tags && node.tags.length > 0 ? `标签：${node.tags.join('、')}` : ''
            ].filter(Boolean).join(' / '),
            叙事核心: narrativeCoreSummary(node),
            父级ID: node.parentId || ''
        }));
};

export const createWorldConfigWithDiy = (worldConfig: WorldGenConfig): WorldGenConfig => ({
    ...worldConfig,
    realmDiyDraft: normalizeRealmDraft(worldConfig.realmDiyDraft),
    mapDiyDraft: normalizeWorldMapDraft(worldConfig.mapDiyDraft)
});
