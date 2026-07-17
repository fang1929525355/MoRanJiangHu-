import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { 小说模式包题材选择器 } from '../components/features/Settings/NovelDecompositionSettings';
import { 题材模式顺序 } from '../utils/topicModeProfiles';

describe('小说分解模式包题材选择', () => {
    it('展示全部官方题材并明确手动选择会覆盖自动识别', () => {
        const html = renderToStaticMarkup(
            <小说模式包题材选择器 value="武侠" onChange={() => undefined} />
        );

        expect(html).toContain('模式包题材');
        expect(html).toContain('手动选择会覆盖自动识别');
        expect(html).toContain('data-novel-mode-topic="武侠"');
        for (const mode of 题材模式顺序) {
            expect(html).toContain(`value="${mode}"`);
        }
    });

    it('白天模式使用独立类名保证选择器可读', () => {
        const html = renderToStaticMarkup(
            <小说模式包题材选择器 value="现代都市" onChange={() => undefined} />
        );

        expect(html).toContain('novel-mode-topic-select');
    });
});
