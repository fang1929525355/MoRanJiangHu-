import { afterEach, describe, expect, it, vi } from 'vitest';
import { 请求模型文本, type 通用流式结束信息 } from '../services/ai/chatCompletionClient';
import { generateStoryResponse } from '../services/ai/storyTasks';
import { 判定主剧情重试流式策略, 是否流式意外终止错误, 流式意外终止降级提示 } from '../hooks/useGame/sendWorkflow';
import type { 当前可用接口结构 } from '../utils/apiConfig';

const baseConfig: 当前可用接口结构 = {
    id: 'test',
    名称: 'test',
    供应商: 'openai_compatible',
    协议覆盖: 'auto',
    baseUrl: 'https://example.com/v1',
    apiKey: 'test-key',
    model: 'test-model'
};

const 构建SSE流式响应 = (frames: string[], options?: { 发送DONE信号?: boolean }): Response => {
    const payload = frames.map((frame) => `data: ${frame}\n\n`).join('')
        + (options?.发送DONE信号 === false ? '' : 'data: [DONE]\n\n');
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(payload));
            controller.close();
        }
    });
    return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
    });
};

const 完整协议帧 = (正文: string) => JSON.stringify({
    choices: [{
        delta: {
            content: `<正文>\n【旁白】${正文}</正文>\n<短期记忆>无</短期记忆>\n<命令>\n</命令>`
        }
    }]
});

describe('流式意外终止检测与非流式降级', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('SSE 流结束时会通过 onStreamEnd 上报是否收到 [DONE]', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(构建SSE流式响应([
            '{"choices":[{"delta":{"content":"完整内容"}}]}'
        ]));
        const endInfos: 通用流式结束信息[] = [];

        const result = await 请求模型文本(baseConfig, [{ role: 'user', content: 'ping' }], {
            temperature: 0.7,
            streamOptions: { stream: true, onDelta: () => {}, onStreamEnd: (info) => endInfos.push(info) }
        });

        expect(result).toBe('完整内容');
        expect(endInfos).toHaveLength(1);
        expect(endInfos[0].sawDone).toBe(true);
    });

    it('连接被上游提前关闭（无 [DONE]）时 onStreamEnd 上报 sawDone=false', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(构建SSE流式响应([
            '{"choices":[{"delta":{"content":"说到一半"}}]}'
        ], { 发送DONE信号: false }));
        const endInfos: 通用流式结束信息[] = [];

        const result = await 请求模型文本(baseConfig, [{ role: 'user', content: 'ping' }], {
            temperature: 0.7,
            streamOptions: { stream: true, onDelta: () => {}, onStreamEnd: (info) => endInfos.push(info) }
        });

        expect(result).toBe('说到一半');
        expect(endInfos).toHaveLength(1);
        expect(endInfos[0].sawDone).toBe(false);
        expect(endInfos[0].accumulatedLength).toBeGreaterThan(0);
    });

    it('流式被掐断且响应截断无法解析时，错误打上“流式意外终止”标记并跳过截断稿修复', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(构建SSE流式响应([
            '{"choices":[{"delta":{"content":"<正文>\\n【旁白】她被骂作娼"}}]}'
        ], { 发送DONE信号: false }));

        const caught = await generateStoryResponse(
            '',
            '',
            '',
            baseConfig,
            undefined,
            { stream: true, onDelta: () => {} },
            '',
            {
                orderedMessages: [{ role: 'user', content: '继续' }],
                enableTagRepair: false,
                validateTagCompleteness: true
            }
        ).then(
            () => null,
            (error: any) => error
        );

        expect(caught).toBeTruthy();
        expect(caught?.流式意外终止).toBe(true);
        expect(是否流式意外终止错误(caught)).toBe(true);
    });

    it('finish_reason=content_filter 时即使收到 [DONE] 也标记为流式意外终止', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(构建SSE流式响应([
            '{"choices":[{"delta":{"content":"<正文>\\n【旁白】话到一半"}}]}',
            '{"choices":[{"delta":{},"finish_reason":"content_filter"}]}'
        ]));

        const caught = await generateStoryResponse(
            '',
            '',
            '',
            baseConfig,
            undefined,
            { stream: true, onDelta: () => {} },
            '',
            {
                orderedMessages: [{ role: 'user', content: '继续' }],
                enableTagRepair: false,
                validateTagCompleteness: true
            }
        ).then(
            () => null,
            (error: any) => error
        );

        expect(caught).toBeTruthy();
        expect(caught?.流式意外终止).toBe(true);
    });

    it('未收到 [DONE] 但响应完整可解析时正常接受，不误伤省略 DONE 信号的供应商', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(构建SSE流式响应([
            完整协议帧('完整故事。')
        ], { 发送DONE信号: false }));

        const result = await generateStoryResponse(
            '',
            '',
            '',
            baseConfig,
            undefined,
            { stream: true, onDelta: () => {} },
            '',
            {
                orderedMessages: [{ role: 'user', content: '继续' }],
                enableTagRepair: false
            }
        );

        expect(result.response.logs?.some((log) => typeof log?.text === 'string' && log.text.includes('完整故事'))).toBe(true);
    });

    it('是否流式意外终止错误 覆盖各类错误形态', () => {
        expect(是否流式意外终止错误(null)).toBe(false);
        expect(是否流式意外终止错误(undefined)).toBe(false);
        expect(是否流式意外终止错误(new DOMException('Aborted', 'AbortError'))).toBe(false);
        expect(是否流式意外终止错误(new Error('普通业务错误'))).toBe(false);

        expect(是否流式意外终止错误(Object.assign(new Error('解析失败'), { 流式意外终止: true }))).toBe(true);
        expect(是否流式意外终止错误(new Error('unexpected end of stream on com.android.okhttp.Address@4ea9fa8e'))).toBe(true);
        expect(是否流式意外终止错误(new Error('模型流式连接中途断开，通常是网络波动、代理断流或上游模型服务提前关闭连接导致'))).toBe(true);

        const idleTimeout = new Error('主剧情乾坤推演流式输出空闲超时（120 秒无新增量）');
        idleTimeout.name = 'TimeoutError';
        expect(是否流式意外终止错误(idleTimeout)).toBe(true);

        const firstResponseTimeout = new Error('主剧情乾坤推演等待首次响应超时（60 秒）');
        firstResponseTimeout.name = 'TimeoutError';
        expect(是否流式意外终止错误(firstResponseTimeout)).toBe(false);
    });

    it('降级提示向玩家说明已自动切换非流式', () => {
        expect(流式意外终止降级提示).toContain('非流式');
        expect(流式意外终止降级提示).toContain('内容审核');
    });

    it('第一次流式请求意外终止后，第二次重试明确改用非流式', async () => {
        const requestModes: Array<{ stream: true } | undefined> = [];
        let fallbackToNonStreaming = false;
        let lastError: any = null;

        for (let attempt = 1; attempt <= 2; attempt += 1) {
            const strategy = 判定主剧情重试流式策略({
                isStreaming: true,
                fallbackToNonStreaming,
                lastError
            });
            fallbackToNonStreaming = strategy.fallbackToNonStreaming;
            requestModes.push(strategy.useStreaming ? { stream: true } : undefined);

            if (attempt === 1) {
                lastError = Object.assign(new Error('上游连接提前关闭'), { 流式意外终止: true });
                continue;
            }
        }

        expect(requestModes).toEqual([{ stream: true }, undefined]);
        expect(fallbackToNonStreaming).toBe(true);
    });
});
