export type 文章优化请求超时参数<T> = {
    parentSignal: AbortSignal;
    firstResponseTimeoutMs: number;
    streamIdleTimeoutMs: number;
    task: (
        signal: AbortSignal,
        onDelta: (delta: string, accumulated: string) => void
    ) => Promise<T>;
    resolveCompletedDraft: (accumulated: string) => T | null;
};

const 创建超时错误 = (message: string): Error => {
    const error = new Error(message);
    error.name = 'TimeoutError';
    return error;
};

export const 执行文章优化请求带超时 = async <T>({
    parentSignal,
    firstResponseTimeoutMs,
    streamIdleTimeoutMs,
    task,
    resolveCompletedDraft
}: 文章优化请求超时参数<T>): Promise<T> => {
    if (parentSignal.aborted) {
        throw parentSignal.reason ?? new DOMException('请求已取消', 'AbortError');
    }

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let accumulated = '';
    let receivedResponse = false;
    let settled = false;

    return new Promise<T>((resolve, reject) => {
        const clearTimer = () => {
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
        };

        const cleanup = () => {
            clearTimer();
            parentSignal.removeEventListener('abort', handleParentAbort);
        };

        const settleResolve = (value: T) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(value);
        };

        const settleReject = (reason: unknown) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(reason);
        };

        const handleTimeout = () => {
            const completedDraft = resolveCompletedDraft(accumulated);
            if (completedDraft !== null) {
                settleResolve(completedDraft);
            } else {
                settleReject(创建超时错误(receivedResponse ? '文章优化流式输出空闲超时' : '文章优化等待首次响应超时'));
            }
            controller.abort(new DOMException('文章优化请求超时', 'AbortError'));
        };

        const resetTimer = (timeoutMs: number) => {
            clearTimer();
            timer = setTimeout(handleTimeout, timeoutMs);
        };

        function handleParentAbort() {
            const reason = parentSignal.reason ?? new DOMException('请求已取消', 'AbortError');
            settleReject(reason);
            controller.abort(reason);
        }

        parentSignal.addEventListener('abort', handleParentAbort, { once: true });
        resetTimer(firstResponseTimeoutMs);

        void task(controller.signal, (_delta, currentAccumulated) => {
            if (settled) return;
            receivedResponse = true;
            accumulated = currentAccumulated;
            resetTimer(streamIdleTimeoutMs);
        }).then(settleResolve, settleReject);
    });
};
