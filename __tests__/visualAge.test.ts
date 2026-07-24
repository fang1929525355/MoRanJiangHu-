import { describe, expect, it } from 'vitest';
import { 自动角色锚点视觉年龄是否过期, 构建视觉年龄签名, 解析视觉年龄 } from '../utils/visualAge';

describe('visualAge', () => {
    it('keeps a high-realm xianxia elder visually mature instead of elderly', () => {
        const result = 解析视觉年龄({
            actualAge: 85,
            topicMode: '仙侠',
            realmLevel: 17,
            realmText: '金丹四层',
            identity: '玉仙宗巡查使',
            appearance: '容貌清寒，体态挺拔。',
            bio: '修行多年，无明显老态。'
        });

        expect(result.visualAgeBand).toBe('mature_adult');
        expect(result.isAdultSafetyApproved).toBe(true);
        expect(result.positiveTags).not.toContain('85 years old');
        expect(result.negativeTags).toContain('elderly appearance');
    });

    it('keeps realistic elders in the elderly band', () => {
        const result = 解析视觉年龄({
            actualAge: 85,
            topicMode: '现代都市',
            identity: '退休老人'
        });

        expect(result.visualAgeBand).toBe('elderly');
        expect(result.positiveTags).toContain('85 years old');
        expect(result.positiveTags).toContain('elderly appearance');
    });

    it('never upgrades a real minor into an adult visual age', () => {
        const result = 解析视觉年龄({
            actualAge: 16,
            topicMode: '仙侠',
            realmLevel: 30,
            realmText: '元婴境',
            identity: '天才弟子'
        });

        expect(result.visualAgeBand).toBe('late_teen');
        expect(result.isAdultSafetyApproved).toBe(false);
    });

    it('treats explicit childlike appearance as unsafe for adult nsfw', () => {
        const result = 解析视觉年龄({
            actualAge: 200,
            topicMode: '仙侠',
            realmLevel: 24,
            explicitVisualAge: '幼童外貌'
        });

        expect(result.visualAgeBand).toBe('child');
        expect(result.isAdultSafetyApproved).toBe(false);
    });

    it('invalidates stale automatic anchors when visual age changed bands', () => {
        const current = 解析视觉年龄({
            actualAge: 85,
            topicMode: '仙侠',
            realmLevel: 17,
            realmText: '金丹四层'
        });

        expect(自动角色锚点视觉年龄是否过期({
            来源: 'ai_extract',
            视觉年龄签名: 'v2:elderly:85:actual:adult',
            正面提示词: 'elderly woman, wrinkles',
            负面提示词: ''
        }, current)).toBe(true);

        expect(自动角色锚点视觉年龄是否过期({
            来源: 'ai_extract',
            视觉年龄签名: 构建视觉年龄签名(current),
            正面提示词: 'adult woman, mature youthful face',
            负面提示词: 'elderly appearance'
        }, current)).toBe(false);
    });
});
