import { beforeEach, describe, expect, it, vi } from 'vitest';

const schedulerMocks = vi.hoisted(() => ({
    readTasks: vi.fn(),
    readDatasets: vi.fn(),
    updateStatus: vi.fn()
}));

vi.mock('../services/novelDecompositionStore', () => ({
    读取小说拆分任务列表: schedulerMocks.readTasks,
    读取小说拆分数据集列表: schedulerMocks.readDatasets,
    筛选可后台续跑任务: (tasks: any[]) => tasks.filter((task) => (
        task.后台运行 === true
        && task.自动续跑 === true
        && ['queued', 'running'].includes(task.状态)
    )),
    获取小说拆分任务状态文本: vi.fn().mockReturnValue('执行中'),
    获取小说拆分任务排序分值: vi.fn().mockReturnValue(0),
    更新小说拆分任务状态: schedulerMocks.updateStatus
}));

import { 小说拆分后台调度服务 } from '../services/novelDecompositionScheduler';

describe('小说分解调度退避', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-03T00:00:00.000Z'));
        小说拆分后台调度服务.stop();
        小说拆分后台调度服务.resetLiveState();
        schedulerMocks.readDatasets.mockResolvedValue([]);
    });

    it('下次补漏时间未到时跳过任务', async () => {
        const executor = vi.fn().mockResolvedValue({ type: 'progress', message: '继续' });
        小说拆分后台调度服务.registerExecutor(executor);
        schedulerMocks.readTasks.mockResolvedValue([{
            id: 'task-future', 名称: '等待退避', 状态: 'running', 后台运行: true, 自动续跑: true,
            下次补漏时间: Date.now() + 10_000, updatedAt: 1
        }]);

        const state = await 小说拆分后台调度服务.tick();

        expect(executor).not.toHaveBeenCalled();
        expect(state.resumableTaskCount).toBe(0);
    });

    it('下次补漏时间已到时执行任务', async () => {
        const executor = vi.fn().mockResolvedValue({ type: 'progress', message: '继续' });
        小说拆分后台调度服务.registerExecutor(executor);
        schedulerMocks.readTasks.mockResolvedValue([{
            id: 'task-ready', 名称: '退避结束', 状态: 'running', 后台运行: true, 自动续跑: true,
            下次补漏时间: Date.now(), updatedAt: 1
        }]);

        await 小说拆分后台调度服务.tick();

        expect(executor).toHaveBeenCalledOnce();
        expect(executor).toHaveBeenCalledWith(expect.objectContaining({
            task: expect.objectContaining({ id: 'task-ready' })
        }));
    });
});
