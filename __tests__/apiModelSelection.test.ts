import { describe, expect, it } from 'vitest';

import { 是否GeminiDeepResearch配置, 解析模型列表后的选择, 选择最佳可用模型 } from '../components/features/Settings/ApiSettings';
import { 创建接口配置模板, 构建OpenAI兼容模型列表候选地址, 获取剧情回忆接口配置, 获取世界演变接口配置, 获取规划分析接口配置, 规范化接口设置, 推断供应商, 供应商标签 } from '../utils/apiConfig';

describe('接口模型自动选择', () => {
    it('优先选择同渠道返回列表中版本号更大的高能力模型', () => {
        expect(选择最佳可用模型([
            'gemini-2.5-pro',
            'gemini-2.0-pro',
            'gemini-2.5-flash',
            'text-embedding-004'
        ])).toBe('gemini-2.5-pro');
    });

    it('不会在小米等非 GPT 渠道测试时硬保留 GPT 模型', () => {
        expect(选择最佳可用模型([
            'moonshot-v1-8k',
            'moonshot-v1-32k',
            'moonshot-v1-128k',
            'moonshot-v1-8k-vision-preview'
        ])).toBe('moonshot-v1-128k');
    });

    it('过滤空值并避开图片、语音和嵌入类模型', () => {
        expect(选择最佳可用模型([
            '',
            'gpt-image-2',
            'text-embedding-3-large',
            'gpt-5-mini',
            'gpt-5'
        ])).toBe('gpt-5');
    });

    it('Deep Research 协议提示仍能独立识别，不参与模型自动选择', () => {
        expect(是否GeminiDeepResearch配置(
            'gemini-2.5-pro-deep-research',
            'https://generativelanguage.googleapis.com/v1beta'
        )).toBe(true);
        expect(是否GeminiDeepResearch配置(
            'agy-gpt-oss-120b-medium',
            'https://example.com/v1'
        )).toBe(false);
    });

    it('获取列表或测试连接时保留用户当前选择，不自动切换成评分更高的模型', () => {
        expect(解析模型列表后的选择('agy-gpt-oss-120b-medium', [
            'gemini-2.5-pro',
            'agy-gpt-oss-120b-medium'
        ])).toBe('agy-gpt-oss-120b-medium');
    });

    it('只有当前模型为空时才自动选择一个可用模型', () => {
        expect(解析模型列表后的选择('', [
            'gemini-2.5-flash',
            'gemini-2.5-pro'
        ])).toBe('gemini-2.5-pro');
    });
});

describe('小米 MiMo 接口配置', () => {
    it('提供 API 和 Token Plan 两种内置供应商模板', () => {
        const apiConfig = 创建接口配置模板('mimo_api');
        const tokenPlanConfig = 创建接口配置模板('mimo_token_plan');

        expect(供应商标签.mimo_api).toBe('小米 MiMo API');
        expect(供应商标签.mimo_token_plan).toBe('小米 MiMo Token Plan');
        expect(apiConfig.供应商).toBe('mimo_api');
        expect(apiConfig.baseUrl).toBe('https://api.xiaomimimo.com/v1');
        expect(apiConfig.model).toBe('mimo-v2.5-pro');
        expect(tokenPlanConfig.供应商).toBe('mimo_token_plan');
        expect(tokenPlanConfig.baseUrl).toBe('https://token-plan-cn.xiaomimimo.com/v1');
        expect(tokenPlanConfig.model).toBe('mimo-v2.5-pro');
    });

    it('根据小米官方和 Token Plan 地址自动推断供应商', () => {
        expect(推断供应商('https://api.xiaomimimo.com/v1')).toBe('mimo_api');
        expect(推断供应商('https://api.xiaomimimo.com/anthropic')).toBe('mimo_api');
        expect(推断供应商('https://token-plan-cn.xiaomimimo.com/v1')).toBe('mimo_token_plan');
        expect(推断供应商('https://token-plan-cn.xiaomimimo.com/anthropic')).toBe('mimo_token_plan');
    });
});

describe('OpenAI 兼容模型列表地址', () => {
    it('优先使用百度千帆 v2 的模型列表地址，避免错误插入 /v1', () => {
        expect(构建OpenAI兼容模型列表候选地址('https://qianfan.baidubce.com/v2/')).toEqual([
            'https://qianfan.baidubce.com/v2/models',
            'https://qianfan.baidubce.com/models'
        ]);
    });

    it('优先使用自定义 OpenAI 兼容版本路径的模型列表地址，避免错误插入 /v1', () => {
        expect(构建OpenAI兼容模型列表候选地址('https://example.com/api/paas/v4')).toEqual([
            'https://example.com/api/paas/v4/models',
            'https://example.com/api/paas/models',
            'https://example.com/models'
        ]);
    });

    it('保留普通 OpenAI 兼容地址的 v1/models 兼容探测顺序', () => {
        expect(构建OpenAI兼容模型列表候选地址('https://example.com/v1')).toEqual([
            'https://example.com/v1/models',
            'https://example.com/models'
        ]);
    });
});

describe('阶段上游模型解析', () => {
    const createSettings = (recallModel: string) => 规范化接口设置({
        activeConfigId: 'main-channel',
        configs: [
            {
                ...创建接口配置模板('openai_compatible'),
                id: 'main-channel',
                名称: '主剧情渠道',
                baseUrl: 'https://main.example.test/v1',
                apiKey: 'main-key',
                model: 'main-model'
            },
            {
                ...创建接口配置模板('openai_compatible'),
                id: 'recall-channel',
                名称: '剧情回忆渠道',
                baseUrl: 'https://recall.example.test/v1',
                apiKey: 'recall-key',
                model: 'recall-default-model'
            }
        ],
        功能模型占位: {
            剧情回忆独立模型开关: true,
            剧情回忆渠道ID: 'recall-channel',
            剧情回忆使用模型: recallModel
        }
    });

    it('阶段模型为空时会使用所选渠道默认模型', () => {
        const config = 获取剧情回忆接口配置(createSettings(''));

        expect(config?.id).toBe('recall-channel');
        expect(config?.baseUrl).toBe('https://recall.example.test/v1');
        expect(config?.apiKey).toBe('recall-key');
        expect(config?.model).toBe('recall-default-model');
    });

    it('阶段旧模型会覆盖新渠道默认模型', () => {
        const config = 获取剧情回忆接口配置(createSettings('main-model'));

        expect(config?.id).toBe('recall-channel');
        expect(config?.baseUrl).toBe('https://recall.example.test/v1');
        expect(config?.apiKey).toBe('recall-key');
        expect(config?.model).toBe('main-model');
    });

    it('阶段旧 API 地址会覆盖新渠道默认端点', () => {
        const config = 获取剧情回忆接口配置({
            ...规范化接口设置({
                activeConfigId: 'main-channel',
                configs: [
                    { ...创建接口配置模板('openai_compatible'), id: 'main-channel', 名称: '主剧情渠道', baseUrl: 'https://main.example.test/v1', apiKey: 'main-key', model: 'main-model' },
                    { ...创建接口配置模板('openai_compatible'), id: 'recall-channel', 名称: '剧情回忆渠道', baseUrl: 'https://recall.example.test/v1', apiKey: 'recall-key', model: 'recall-default-model' }
                ],
                功能模型占位: {
                    剧情回忆独立模型开关: true,
                    剧情回忆渠道ID: 'recall-channel',
                    剧情回忆使用模型: '',
                    剧情回忆API地址: 'https://old-manual-endpoint.test/v1',
                    剧情回忆API密钥: 'old-manual-key'
                }
            })
        });

        expect(config?.id).toBe('recall-channel');
        expect(config?.baseUrl).toBe('https://old-manual-endpoint.test/v1');
        expect(config?.apiKey).toBe('old-manual-key');
        expect(config?.model).toBe('recall-default-model');
    });

    it('动态世界未配置独立模型时复用主剧情接口', () => {
        const settings = 规范化接口设置({
            activeConfigId: 'main-channel',
            configs: [
                {
                    ...创建接口配置模板('openai_compatible'),
                    id: 'main-channel',
                    名称: '主剧情渠道',
                    baseUrl: 'https://main.example.test/v1',
                    apiKey: 'main-key',
                    model: 'main-model'
                }
            ],
            功能模型占位: {
                世界演变功能启用: true,
                世界演变独立模型开关: false,
                世界演变使用模型: ''
            }
        });

        const config = 获取世界演变接口配置(settings);

        expect(config?.id).toBe('main-channel');
        expect(config?.baseUrl).toBe('https://main.example.test/v1');
        expect(config?.apiKey).toBe('main-key');
        expect(config?.model).toBe('main-model');
    });

    it('规划分析未配置独立模型时复用主剧情接口', () => {
        const settings = 规范化接口设置({
            activeConfigId: 'main-channel',
            configs: [
                {
                    ...创建接口配置模板('openai_compatible'),
                    id: 'main-channel',
                    名称: '主剧情渠道',
                    baseUrl: 'https://main.example.test/v1',
                    apiKey: 'main-key',
                    model: 'main-model'
                }
            ],
            功能模型占位: {
                规划分析功能启用: true,
                规划分析独立模型开关: false,
                规划分析使用模型: ''
            }
        });

        const config = 获取规划分析接口配置(settings);

        expect(config?.id).toBe('main-channel');
        expect(config?.baseUrl).toBe('https://main.example.test/v1');
        expect(config?.apiKey).toBe('main-key');
        expect(config?.model).toBe('main-model');
    });

    it('动态世界总开关关闭时不复用主剧情接口', () => {
        const settings = 规范化接口设置({
            activeConfigId: 'main-channel',
            configs: [
                {
                    ...创建接口配置模板('openai_compatible'),
                    id: 'main-channel',
                    名称: '主剧情渠道',
                    baseUrl: 'https://main.example.test/v1',
                    apiKey: 'main-key',
                    model: 'main-model'
                }
            ],
            功能模型占位: {
                世界演变功能启用: false,
                世界演变独立模型开关: false
            }
        });

        expect(获取世界演变接口配置(settings)).toBeNull();
    });
});
