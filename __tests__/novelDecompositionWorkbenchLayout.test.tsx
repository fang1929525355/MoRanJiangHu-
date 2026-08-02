import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import NovelDecompositionWorkbenchModal from '../components/features/NovelDecomposition/NovelDecompositionWorkbenchModal';

vi.mock('../components/features/Settings/NovelDecompositionSettings', () => ({
    default: () => <div data-testid="novel-decomposition-settings">settings</div>
}));

describe('小说分解工作台布局', () => {
    it('桌面工作台使用接近全屏的可用空间', () => {
        const html = renderToStaticMarkup(
            <NovelDecompositionWorkbenchModal
                open
                settings={{} as any}
                onSave={() => undefined}
                onClose={() => undefined}
            />
        );

        expect(html).toContain('h-[100dvh]');
        expect(html).toContain('md:h-[calc(100dvh-1.5rem)]');
        expect(html).toContain('md:max-w-[calc(100vw-1.5rem)]');
        expect(html).not.toContain('md:max-w-7xl');
        expect(html).not.toContain('md:h-[88vh]');
        expect(html).not.toContain('md:max-h-[92vh]');
    });

    it('章节筛选和分段校对默认展开并用数据集切换替代折叠入口', () => {
        const source = fs.readFileSync(
            path.join(process.cwd(), 'components/features/Settings/NovelDecompositionSettings.tsx'),
            'utf8'
        );

        expect(source).not.toContain('showChapterSection');
        expect(source).not.toContain('showSegmentSection');
        expect(source).not.toContain('列表已折叠');
        expect(source).not.toContain('面板已折叠');
        expect(source).not.toContain('展开列表');
        expect(source).not.toContain('双栏模式');
        expect(source).toContain('切换数据集');
    });

    it('章节筛选和分段校对的数据集切换条位于内容区最顶部', () => {
        const source = fs.readFileSync(
            path.join(process.cwd(), 'components/features/Settings/NovelDecompositionSettings.tsx'),
            'utf8'
        );

        const switcherIndex = source.indexOf('day-mode-novel-dataset-switcher');
        const saveActionsIndex = source.indexOf('novel-settings-save-actions');
        const segmentHeaderIndex = source.indexOf('分段条目双栏校对');

        expect(switcherIndex).toBeGreaterThan(-1);
        expect(saveActionsIndex).toBeGreaterThan(-1);
        expect(segmentHeaderIndex).toBeGreaterThan(-1);
        expect(source).toContain('novel-dataset-switcher-button');
        expect(source).toContain('novel-dataset-switcher-panel');
        expect(switcherIndex).toBeLessThan(saveActionsIndex);
        expect(switcherIndex).toBeLessThan(segmentHeaderIndex);
    });

    it('分段档案编辑区使用卡片分区网格避免字段浪费或截断', () => {
        const source = fs.readFileSync(
            path.join(process.cwd(), 'components/features/Settings/NovelDecompositionSettings.tsx'),
            'utf8'
        );

        expect(source).toContain('novel-archive-fields');
        expect(source).toContain('novel-archive-short-grid');
        expect(source).toContain('grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))]');
        expect(source).toContain('novel-archive-long-grid');
        expect(source).toContain('grid-cols-[repeat(auto-fit,minmax(18rem,1fr))]');
        expect(source).toContain('novel-archive-long-textarea');
        expect(source).toContain('novel-segment-detail-scroll');
        expect(source).toContain('segmentDetailScrollRef.current?.scrollTo({ top: 0 })');
        expect(source).not.toContain('2xl:grid-cols-8');
        expect(source).not.toContain('xl:grid-cols-3');
        expect(source).not.toContain('pr-6 grid grid-cols-2 md:grid-cols-4 gap-2');
        expect(source).not.toContain('pr-6 grid grid-cols-2 md:grid-cols-3 gap-2');
        expect(source).not.toContain('sticky bottom-0 -mx-4 lg:-mx-5');
    });

    it('分段核心摘要和事实字段在宽屏并排展示', () => {
        const source = fs.readFileSync(
            path.join(process.cwd(), 'components/features/Settings/NovelDecompositionSettings.tsx'),
            'utf8'
        );

        expect(source).toContain('novel-segment-summary-grid');
        expect(source).toContain('grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)]');
        expect(source).toContain('本组概括 (上帝视角)');
        expect(source).toContain('开局已成立事实');
        expect(source).toContain('前组延续事实');
    });

    it('创意工坊等操作页保留不遮挡内容的保存设置入口', () => {
        const source = fs.readFileSync(
            path.join(process.cwd(), 'components/features/Settings/NovelDecompositionSettings.tsx'),
            'utf8'
        );

        expect(source).toContain('novel-settings-save-actions');
        expect(source).not.toContain('sticky bottom-0');
        expect(source).toContain('保存设置');
    });

    it('首页在线人数悬浮提示不会压过独立工作台界面', () => {
        const css = fs.readFileSync(
            path.join(process.cwd(), 'styles/global.css'),
            'utf8'
        );
        const match = css.match(/\.landing-presence-native-tooltip\s*{[\s\S]*?z-index:\s*(\d+)/);

        expect(match?.[1]).toBeDefined();
        expect(Number(match?.[1])).toBeLessThan(200);
    });

    it('任务管理页在宽屏使用更大的内容区和可读的监控栏', () => {
        const source = fs.readFileSync(
            path.join(process.cwd(), 'components/features/Settings/NovelDecompositionSettings.tsx'),
            'utf8'
        );

        expect(source).toContain('novel-task-management-layout');
        expect(source).toContain('max-w-[1800px]');
        expect(source).toContain('xl:grid-cols-[minmax(0,1.45fr)_minmax(420px,0.9fr)]');
        expect(source).not.toContain('lg:grid-cols-[1fr_320px]');
        expect(source).toContain('line-clamp-4');
        expect(source).toContain('novel-chapter-progress-grid');
        expect(source).toContain('grid-cols-[repeat(auto-fit,minmax(8rem,1fr))]');
        expect(source).toContain('novel-task-summary-grid');
        expect(source).toContain('grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]');
        expect(source.indexOf('novel-task-management-layout')).toBeGreaterThan(source.indexOf("mobileTab === 'tasks'"));
    });
});
