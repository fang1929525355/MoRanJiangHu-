import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');

const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const extractCssBlock = (css: string, startIndex: number) => {
    const openBraceIndex = css.indexOf('{', startIndex);
    if (openBraceIndex < 0) return '';

    let depth = 0;
    for (let index = openBraceIndex; index < css.length; index += 1) {
        if (css[index] === '{') depth += 1;
        if (css[index] === '}') {
            depth -= 1;
            if (depth === 0) return css.slice(startIndex, index + 1);
        }
    }
    return '';
};

describe('低高度桌面端紧凑布局', () => {
    it('为主界面关键区域提供稳定的样式挂钩', () => {
        const app = read('App.tsx');
        const inputArea = read('components/features/Chat/InputArea.tsx');
        const rightPanel = read('components/layout/RightPanel.tsx');
        const topBar = read('components/layout/TopBar.tsx');

        expect(app).toContain('desktop-game-frame');
        expect(app).toContain('desktop-game-main');
        expect(app).toContain('desktop-game-bottom-ticker');
        expect(app).toContain('desktop-game-status-badges');
        expect(app).toContain('app-main-model-badge');
        expect(inputArea).toContain('desktop-quick-actions');
        expect(inputArea).toContain('desktop-quick-actions-list');
        expect(inputArea).toContain('desktop-quick-action-button');
        expect(rightPanel).toContain('right-panel-menu-scroll');
        expect(rightPanel).toContain('right-panel-system-actions');
        expect(topBar).toContain('desktop-game-topbar');
        expect(topBar).toContain('desktop-game-topbar-date-card');
    });

    it('在不超过 800px 高的桌面视口启用独立滚动和紧凑尺寸', () => {
        const css = read('styles/global.css');

        expect(css).toContain('@media (min-width: 768px) and (max-height: 800px)');
        expect(css).toMatch(/\.desktop-quick-actions\s*\{[^}]*max-height:[^;}]+;[^}]*overflow-y:\s*auto;/s);
        expect(css).toMatch(/\.right-panel-menu-scroll\s*\{[^}]*overflow-y:\s*auto;/s);
        expect(css).toMatch(/\.app-play-mode-badge,\s*\.app-main-model-badge\s*\{[^}]*display:\s*none\s*!important;/s);
        expect(css).toMatch(/\.desktop-game-bottom-ticker\s*\{[^}]*height:\s*30px\s*!important;/s);

        const compactMediaQueries = [...css.matchAll(/@media \(min-width: 768px\) and \(max-height: 800px\)/g)];
        const desktopMediaQueryIndex = css.indexOf('@media (min-width: 768px) {');
        const finalCompactMediaQueryIndex = compactMediaQueries.at(-1)?.index ?? -1;
        const finalCompactBlock = extractCssBlock(css, finalCompactMediaQueryIndex);

        expect(finalCompactMediaQueryIndex).toBeGreaterThan(desktopMediaQueryIndex);
        expect(finalCompactBlock).not.toBe('');
        expect(finalCompactBlock).toMatch(/--desktop-game-top:\s*60px;/);
        expect(finalCompactBlock).toMatch(/--desktop-game-bottom:\s*46px;/);
    });
});
