/**
 * NPC 调试日志开关的单一事实来源。
 *
 * 早期实现直接读取 localStorage['DEBUG_NPC_AUTO_IMAGE'] 作为隐式后门，
 * 没有任何界面入口，玩家一旦在 devtools 打开就无法关闭，且容易被误认为“报错”刷屏。
 * 现统一改为由游戏设置 `启用NPC调试日志` 驱动，并在 useGame 钩子里同步到本模块，
 * 让「香闺秘档（NPC 私密生图）/社交规范化」两类调试日志都可通过设置界面正常开关。
 */

let npc调试日志启用 = false;

export const 设置NPC调试日志 = (enabled: boolean): void => {
    npc调试日志启用 = Boolean(enabled);
};

export const NPC调试日志已启用 = (): boolean => npc调试日志启用;
