import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { 执行文章优化请求带超时 } from '../hooks/useGame/polishRequestTimeout';

const 创建挂起任务 = <T,>(onStart?: (onDelta: (delta: string, accumulated: string) => void) => void) => (
    signal: AbortSignal,
    onDelta: (delta: string, accumulated: string) => void
): Promise<T> => {
    onStart?.(onDelta);
    return new Promise<T>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
};

describe('文章优化请求超时', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('等待首个响应超过设置时间后失败', async () => {
        const promise = 执行文章优化请求带超时<string>({
            parentSignal: new AbortController().signal,
            firstResponseTimeoutMs: 1000,
            streamIdleTimeoutMs: 500,
            task: 创建挂起任务<string>(),
            resolveCompletedDraft: () => null
        });

        const assertion = expect(promise).rejects.toThrow('等待首次响应超时');
        await vi.advanceTimersByTimeAsync(1000);
        await assertion;
    });

    it('收到部分正文后按流式空闲时间超时', async () => {
        const promise = 执行文章优化请求带超时<string>({
            parentSignal: new AbortController().signal,
            firstResponseTimeoutMs: 1000,
            streamIdleTimeoutMs: 500,
            task: 创建挂起任务<string>((onDelta) => onDelta('<正文>尚未结束', '<正文>尚未结束')),
            resolveCompletedDraft: () => null
        });

        const assertion = expect(promise).rejects.toThrow('流式输出空闲超时');
        await vi.advanceTimersByTimeAsync(500);
        await assertion;
    });

    it('完整正文已经收到但连接挂起时接受当前草稿', async () => {
        const completed = '<thinking>完成</thinking><正文>完整正文</正文>';
        const promise = 执行文章优化请求带超时<string>({
            parentSignal: new AbortController().signal,
            firstResponseTimeoutMs: 1000,
            streamIdleTimeoutMs: 500,
            task: 创建挂起任务<string>((onDelta) => onDelta(completed, completed)),
            resolveCompletedDraft: (accumulated) => /<正文>[\s\S]*<\/正文>/.test(accumulated) ? accumulated : null
        });

        await vi.advanceTimersByTimeAsync(500);
        await expect(promise).resolves.toBe(completed);
    });

    it('父级主动取消始终保留 AbortError', async () => {
        const parent = new AbortController();
        const promise = 执行文章优化请求带超时<string>({
            parentSignal: parent.signal,
            firstResponseTimeoutMs: 1000,
            streamIdleTimeoutMs: 500,
            task: 创建挂起任务<string>(),
            resolveCompletedDraft: () => null
        });

        parent.abort(new DOMException('用户取消', 'AbortError'));
        await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    });
});
