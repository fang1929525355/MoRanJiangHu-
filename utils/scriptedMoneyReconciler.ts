/**
 * 脚本化金钱增量对账器
 *
 * 问题背景：
 * 拍卖行「玩家寄售」会在下回合自动成交，由脚本通过 `自动增加BaseAmount`
 * 给角色加钱。但 AI 变量模型每条消息都会基于「当前快照」生成
 * `set 角色.金钱 = {...}` 这种绝对命令，且它属于异步 AI 调用，落地时间
 * 晚于同步的拍卖结算 `setCharacter`。结果就是：变量更新用旧快照值把脚本刚
 * 加的钱覆盖掉了（玩家反馈：下回合脚本加的钱被变量更新吞了）。
 *
 * 解决方案：
 * 脚本化系统（拍卖结算等）不再直接抢写 `角色.金钱`，而是把本回合的金钱增量
 * 登记到这里的累加器；变量命令处理器 `执行响应命令处理` 在应用完 AI 命令、
 * 调用 `设置角色` 落地之前，再把这笔增量叠加回去。这样无论 AI 是否发了金钱
 * 命令、无论落地先后，脚本收入都不会丢失。
 *
 * 注意：
 * - 累加器是进程级单例，只在一次游戏内使用；变量模型开始新一轮校准时会先
 *   `resetScriptedMoneyDelta()` 清掉上一轮（可能因中断而残留）的增量。
 * - 使命名清晰：只在「脚本/系统侧主动加钱」时调用 `addScriptedMoneyDelta`，
 *   不要在 AI 命令处理器内部重复登记。
 */

let pendingScriptedMoneyDelta = 0;

/** 登记一笔脚本化金钱增量（底层金额 baseAmount，单位与 `自动增加BaseAmount` 一致）。 */
export const addScriptedMoneyDelta = (amount: number): void => {
    const value = Math.max(0, Math.floor(Number(amount) || 0));
    pendingScriptedMoneyDelta += value;
};

/** 取出并清零当前累计的脚本化金钱增量；若无则返回 0。 */
export const consumeScriptedMoneyDelta = (): number => {
    const value = pendingScriptedMoneyDelta;
    pendingScriptedMoneyDelta = 0;
    return value;
};

/** 只读查看当前累计增量（用于调试/测试）。 */
export const peekScriptedMoneyDelta = (): number => pendingScriptedMoneyDelta;

/** 清零累计增量（变量模型开启新一轮校准时调用，避免上一轮残留污染本轮）。 */
export const resetScriptedMoneyDelta = (): void => {
    pendingScriptedMoneyDelta = 0;
};
