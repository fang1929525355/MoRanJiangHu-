import React from 'react';
import GameButton from '../ui/GameButton';
import { useMusic } from '../features/Music/MusicProvider';
import MusicPlayerUI from '../features/Music/MusicPlayerUI';
import type { 题材界面文案 } from '../../utils/resourceLabels';

interface Props {
    onOpenSettings: () => void;
    onOpenInventory: () => void;
    onOpenEquipment: () => void;
    onOpenBattle: () => void;
    onOpenTeam: () => void;
    onOpenSocial: () => void;
    onOpenKungfu: () => void;
    onOpenWorld: () => void;
    onOpenMap: () => void;
    onOpenSect: () => void;
    onOpenTask: () => void;
    onOpenAgreement: () => void;
    onOpenStory: () => void;
    onOpenHeroinePlan: () => void;
    onOpenMemory: () => void;
    onOpenNovelExport?: () => void;
    onOpenImageManager?: () => void;
    onOpenNovelDecomposition?: () => void;
    onOpenAuctionHouse?: () => void;
    auctionHouseLabel?: string;
    sectLabel?: string;
    uiLabels?: 题材界面文案;
    worldEvolutionEnabled?: boolean;
    worldEvolutionUpdating?: boolean;
    enableWorldPanel?: boolean;
    enableHeroinePlan?: boolean;
    enablePlanningPanel?: boolean;
    enableKungfu?: boolean;
    kungfuLabel?: string;
    onSave: () => void;
    onLoad: () => void;
    onReturnToHome?: () => void;
    returnHomeSaving?: boolean;
    visualConfig?: any;
    latestChangedSections?: string[];
}

const RightPanel: React.FC<Props> = ({
    onOpenSettings,
    onOpenInventory,
    onOpenEquipment,
    onOpenBattle,
    onOpenTeam,
    onOpenSocial,
    onOpenKungfu,
    onOpenWorld,
    onOpenMap,
    onOpenSect,
    onOpenTask,
    onOpenAgreement,
    onOpenStory,
    onOpenHeroinePlan,
    onOpenMemory,
    onOpenNovelExport,
    onOpenImageManager,
    onOpenNovelDecomposition,
    onOpenAuctionHouse,
    auctionHouseLabel = '拍卖行',
    sectLabel = '门派',
    uiLabels,
    worldEvolutionEnabled = false,
    worldEvolutionUpdating = false,
    enableWorldPanel = true,
    enableHeroinePlan = false,
    enablePlanningPanel = true,
    enableKungfu = true,
    kungfuLabel = '功法',
    onSave,
    onLoad,
    onReturnToHome,
    returnHomeSaving = false,
    visualConfig,
    latestChangedSections = []
}) => {
    const { enabled, currentLyric } = useMusic();
    const baseFontSize = Number(visualConfig?.['右侧栏']?.fontSize || visualConfig?.fontSize) || 13;
    const scaleFont = (ratio: number, min = 13) => `${Math.max(min, Math.round(baseFontSize * ratio))}px`;
    const [dismissedChangeKeys, setDismissedChangeKeys] = React.useState<Set<string>>(() => new Set());
    const changeSignature = React.useMemo(() => latestChangedSections.slice().sort().join('|'), [latestChangedSections]);

    React.useEffect(() => {
        setDismissedChangeKeys(new Set());
    }, [changeSignature]);

    const wrapChangedAction = (changeKeys: string[], action: () => void) => () => {
        if (changeKeys.length > 0) {
            setDismissedChangeKeys((prev) => {
                const next = new Set(prev);
                changeKeys.forEach((key) => next.add(key));
                return next;
            });
        }
        action();
    };

    const menuLabel = uiLabels?.菜单;
    const titleLabel = uiLabels?.标题;
    const systemHeaderTitle = titleLabel?.系统菜单题头 || '天机';
    const systemHeaderSubtitle = titleLabel?.系统菜单副题 || 'System Menu';
    const menuItems = [
        { label: menuLabel?.battle || '战斗', action: onOpenBattle, color: 'primary' as const, changeKeys: ['战斗'] },
        { label: menuLabel?.equipment || '装备', action: onOpenEquipment, color: 'primary' as const, changeKeys: ['装备'] },
        { label: menuLabel?.inventory || '背包', action: onOpenInventory, color: 'primary' as const, changeKeys: ['背包'] },
        ...(onOpenAuctionHouse ? [{ label: auctionHouseLabel, action: onOpenAuctionHouse, color: 'primary' as const }] : []),
        { label: menuLabel?.social || '社交', action: onOpenSocial, color: 'primary' as const, changeKeys: ['社交'] },
        ...(enableWorldPanel ? [{
            label: worldEvolutionUpdating ? `${menuLabel?.world || '世界'}·更新中` : (menuLabel?.world || '世界'),
            action: onOpenWorld,
            color: worldEvolutionUpdating ? 'secondary' as const : 'primary' as const,
            changeKeys: ['世界'],
            className: worldEvolutionEnabled && worldEvolutionUpdating
                ? 'animate-pulse shadow-[0_0_18px_rgba(90,220,220,0.35)]'
                : ''
        }] : []),
        { label: menuLabel?.team || '队伍', action: onOpenTeam, color: 'primary' as const, changeKeys: ['队伍'] },
        ...(enableKungfu ? [{ label: kungfuLabel, action: onOpenKungfu, color: 'primary' as const, changeKeys: ['功法'] }] : []),
        { label: menuLabel?.map || '地图', action: onOpenMap, color: 'primary' as const, changeKeys: ['地图'] },
        { label: sectLabel, action: onOpenSect, color: 'primary' as const, changeKeys: ['玩家门派'] },
        { label: menuLabel?.task || '任务', action: onOpenTask, color: 'primary' as const, changeKeys: ['任务列表'] },
        { label: menuLabel?.agreement || '约定', action: onOpenAgreement, color: 'primary' as const, changeKeys: ['约定列表'] },
        { label: menuLabel?.story || '剧情', action: onOpenStory, color: 'primary' as const, changeKeys: ['剧情'] },
        ...(enablePlanningPanel && enableHeroinePlan ? [{ label: menuLabel?.plan || '规划', action: onOpenHeroinePlan, color: 'primary' as const, changeKeys: ['剧情规划'] }] : []),
        { label: menuLabel?.memory || '记忆', action: onOpenMemory, color: 'primary' as const, changeKeys: ['记忆系统'] },
        ...(onOpenNovelExport ? [{ label: '导出小说', action: onOpenNovelExport, color: 'secondary' as const }] : []),
        ...(onOpenImageManager ? [{ label: menuLabel?.imageManager || '图册', action: onOpenImageManager, color: 'secondary' as const }] : []),
        ...(onOpenNovelDecomposition ? [{ label: '分解工坊', action: onOpenNovelDecomposition, color: 'secondary' as const }] : []),
    ];

    const systemItems = [
        { label: '保存进度', action: onSave },
        { label: '读取进度', action: onLoad },
        { label: titleLabel?.系统设置 || '江湖设置', action: onOpenSettings },
        ...(onReturnToHome ? [{
            label: returnHomeSaving ? '正在保存存档中' : '返回首页',
            action: onReturnToHome,
            disabled: returnHomeSaving,
            className: 'text-red-400/80 hover:text-red-300 hover:border-red-900/70 hover:bg-red-950/10 disabled:cursor-wait disabled:opacity-70'
        }] : []),
    ];

    return (
        <div className="right-panel-body h-full flex flex-col p-2 border-l border-wuxia-gold/20 relative bg-transparent">
            <div className="right-panel-ambient absolute inset-0 opacity-5 pointer-events-none bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-gray-700 via-black to-black"></div>

            {enabled ? (
                <div className="mb-4 pb-4 border-b border-gray-800 shrink-0">
                    <MusicPlayerUI />
                </div>
            ) : (
                <div className="right-panel-system-header mb-3 text-center border-b border-gray-800 pb-3 relative h-[62px] flex flex-col justify-center shrink-0">
                    <h1 className="font-black tracking-[0.28em] opacity-90 drop-shadow-md text-wuxia-gold" style={{ fontSize: scaleFont(1.62, 21) }}>{systemHeaderTitle}</h1>
                    <div className="text-gray-600 tracking-[0.14em] mt-0.5 uppercase" style={{ fontSize: scaleFont(0.86, 11), lineHeight: 1.1 }}>{systemHeaderSubtitle}</div>
                    <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-1/2 h-px bg-gradient-to-r from-transparent via-wuxia-gold/50 to-transparent"></div>
                </div>
            )}

            {enabled && currentLyric && (
                <div className="mb-2 -mt-1 text-center overflow-hidden animate-in fade-in duration-700 h-8 flex items-center justify-center">
                    <p className="text-wuxia-gold/90 italic tracking-wider leading-tight px-2 line-clamp-2 drop-shadow-[0_0_3px_rgba(230,200,110,0.3)]" style={{ fontSize: scaleFont(1.02, 14) }}>
                        {currentLyric}
                    </p>
                </div>
            )}

            <div className="right-panel-menu-frame flex-1 flex flex-col gap-2 relative py-1 min-h-0">
                <div className="right-panel-menu-outline absolute inset-0 border border-gray-800 bg-white/[0.02] pointer-events-none">
                    <div className="right-panel-menu-corner absolute top-0 left-0 w-2 h-2 border-t border-l border-gray-600"></div>
                    <div className="right-panel-menu-corner absolute top-0 right-0 w-2 h-2 border-t border-r border-gray-600"></div>
                    <div className="right-panel-menu-corner absolute bottom-0 left-0 w-2 h-2 border-b border-l border-gray-600"></div>
                    <div className="right-panel-menu-corner absolute bottom-0 right-0 w-2 h-2 border-b border-r border-gray-600"></div>
                </div>
                <div className="right-panel-menu-scroll p-2.5 space-y-2 h-full overflow-y-auto no-scrollbar relative z-10">
                    {menuItems.map((item) => {
                        const changeKeys = Array.isArray((item as any).changeKeys) ? (item as any).changeKeys as string[] : [];
                        const hasUnreadChange = changeKeys.some((key) => latestChangedSections.includes(key) && !dismissedChangeKeys.has(key));
                        return (
                        <GameButton
                            key={item.label}
                            onClick={wrapChangedAction(changeKeys, item.action)}
                            variant={item.color}
                            className={`relative w-full text-center py-1.5 tracking-[0.12em] hover:scale-[1.015] transition-transform !skew-x-0 border-opacity-60 ${item.className || ''}`}
                            contentClassName="!skew-x-0"
                        >
                            <span className="whitespace-nowrap" style={{ fontSize: scaleFont(1.08, 14), lineHeight: 1.35 }}>{item.label}</span>
                            {hasUnreadChange && (
                                <span className="absolute right-1.5 top-1.5 h-3 w-3 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,1),0_0_3px_rgba(0,0,0,0.8)] ring-2 ring-white border border-red-600 animate-pulse" />
                            )}
                        </GameButton>
                    );})}
                </div>
            </div>
            <div className="right-panel-system-actions mt-3 pt-3 border-t border-gray-800 space-y-1.5 shrink-0">
                {systemItems.map((item) => (
                    <button
                        key={item.label}
                        onClick={item.action}
                        disabled={(item as any).disabled}
                        className={`right-panel-system-button w-full text-center transition-all py-1 uppercase tracking-[0.08em] border border-transparent hover:border-gray-800 hover:bg-white/5 rounded-sm text-gray-500 ${item.className || ''}`}
                        style={{ fontSize: scaleFont(0.88, 12) }}
                    >
                        [ {item.label} ]
                    </button>
                ))}
            </div>
            <div className="right-panel-bottom-fade absolute bottom-0 left-0 w-full h-8 bg-gradient-to-t from-black/80 to-transparent pointer-events-none"></div>
        </div>
    );
};

export default RightPanel;
