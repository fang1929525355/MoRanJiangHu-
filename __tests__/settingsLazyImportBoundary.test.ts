import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('设置模块懒加载局部错误边界', () => {
    it('settings-world 等旧 chunk 失效时由设置弹窗边界承接，不击穿根界面', () => {
        const source = fs.readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');
        const settingsBlockStart = source.indexOf('{/* Settings Modal */}');
        const settingsBlockEnd = source.indexOf('{showWorldbookManager && (', settingsBlockStart);

        expect(settingsBlockStart).toBeGreaterThanOrEqual(0);
        expect(settingsBlockEnd).toBeGreaterThan(settingsBlockStart);

        const settingsBlock = source.slice(settingsBlockStart, settingsBlockEnd);
        const boundaryOpen = settingsBlock.indexOf('<ModalErrorBoundary title="设置打开失败" onClose={closeSettings}>');
        const suspenseOpen = settingsBlock.indexOf('<懒加载边界>');
        const mobileSettings = settingsBlock.indexOf('<MobileSettingsModal');
        const desktopSettings = settingsBlock.indexOf('<SettingsModal');
        const suspenseClose = settingsBlock.lastIndexOf('</懒加载边界>');
        const boundaryClose = settingsBlock.lastIndexOf('</ModalErrorBoundary>');

        expect(boundaryOpen).toBeGreaterThanOrEqual(0);
        expect(suspenseOpen).toBeGreaterThan(boundaryOpen);
        expect(mobileSettings).toBeGreaterThan(suspenseOpen);
        expect(desktopSettings).toBeGreaterThan(suspenseOpen);
        expect(suspenseClose).toBeGreaterThan(desktopSettings);
        expect(boundaryClose).toBeGreaterThan(suspenseClose);
    });
});
