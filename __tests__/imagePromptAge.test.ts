import { describe, expect, it } from 'vitest';
import { buildNpcDirectImagePrompt } from '../services/ai/image';

describe('image prompt age handling', () => {
    it('does not inject real-age old-face tags for high-realm immortal adults', () => {
        const result = buildNpcDirectImagePrompt({
            性别: '女',
            年龄: 85,
            外观年龄: undefined,
            题材模式: '仙侠',
            境界: '金丹四层',
            境界层级: 17,
            身份: '玉仙宗巡查使',
            外貌: '容貌清寒，体态挺拔。',
            身材: '身形修长，行动利落。',
            衣着: '素白道袍'
        });

        expect(result.生图词组).not.toContain('85 years old');
        expect(result.生图词组).not.toContain('age-accurate face');
        expect(result.生图词组).toContain('mature youthful face');
    });

    it('keeps realistic elders age-accurate', () => {
        const result = buildNpcDirectImagePrompt({
            性别: '女',
            年龄: 85,
            题材模式: '现代都市',
            身份: '退休老人',
            外貌: '满头白发，皱纹深重。'
        });

        expect(result.生图词组).toContain('85 years old');
        expect(result.生图词组).toContain('elderly appearance');
    });
});
