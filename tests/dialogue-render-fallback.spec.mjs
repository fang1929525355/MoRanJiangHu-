import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';

const zip = unzipSync(readFileSync('.tmp-release-assets/WuXia_Save_Data.zip'));
const saveName = Object.keys(zip).find((name) => name.startsWith('saves/') && name.endsWith('.json'));
const baseSave = JSON.parse(strFromU8(zip[saveName]));

const closeReleaseNotesIfOpen = async (page) => {
    const closeButton = page.locator('button[aria-label="关闭更新日志"]');
    await closeButton.waitFor({ state: 'visible', timeout: 2500 }).catch(() => {});
    if (await closeButton.count() && await closeButton.first().isVisible().catch(() => false)) {
        await closeButton.first().click({ timeout: 3000, force: true });
        await closeButton.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    }
    const conversionTitle = page.getByText('旧存档正在转换为新谱系');
    await conversionTitle.waitFor({ state: 'visible', timeout: 1500 }).catch(() => {});
    if (await conversionTitle.count() && await conversionTitle.first().isVisible().catch(() => false)) {
        const genericCloseButton = page.getByRole('button', { name: /^关闭$/ }).last();
        await genericCloseButton.click({ timeout: 3000, force: true });
        await conversionTitle.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    }
};

const clickByTexts = async (page, texts) => {
    for (const text of texts) {
        const button = page.getByRole('button', { name: new RegExp(text) }).first();
        if (await button.count() && await button.isVisible().catch(() => false)) {
            await button.click({ timeout: 3000 });
            return true;
        }
        const locator = page.getByText(text, { exact: false }).first();
        if (await locator.count() && await locator.isVisible().catch(() => false)) {
            await locator.click({ timeout: 3000 });
            return true;
        }
    }
    return false;
};

const makeDialogueFallbackSave = () => {
    const save = structuredClone(baseSave);
    save.id = 9101;
    save.类型 = 'manual';
    save.时间戳 = 1713772800000;
    save.元数据 = {
        ...(save.元数据 || {}),
        名称: '对话框兜底测试',
        现实保存时间戳: 1713772800000,
        现实保存时间ISO: new Date(1713772800000).toISOString()
    };
    save.历史记录 = [
        {
            role: 'user',
            content: '端到端检查对话框兜底'
        },
        {
            role: 'assistant',
            content: 'Structured Response',
            structuredResponse: {
                logs: [
                    {
                        sender: '杨培强',
                        text: '“弟子，领命。”\n\n风，渐渐停了。\n\n铅灰色的云层开始散去。'
                    },
                    {
                        sender: '众人齐声',
                        text: '“遵命！”'
                    },
                    {
                        sender: '杨青儿',
                        text: '“哥，小心些。”'
                    },
                    {
                        sender: '旁白',
                        text: '夜店里的灯光晃了一下。【亨特】“不过，我们今天不是来查税的。”他只是缓缓伸出右手，把冰冷的杯壁贴近嘴唇。'
                    }
                ],
                shortTerm: '端到端检查对话框兜底。'
            }
        }
    ];
    return save;
};

const makeSummary = (save) => ({
    id: save.id,
    类型: save.类型,
    时间戳: save.时间戳,
    元数据: {
        ...(save.元数据 || {}),
        历史记录条数: Array.isArray(save.历史记录) ? save.历史记录.length : 0,
        历史记录是否裁剪: false
    },
    游戏初始时间: save.游戏初始时间,
    角色数据: {
        姓名: save.角色数据?.姓名,
        境界: save.角色数据?.境界,
        境界层级: save.角色数据?.境界层级,
    },
    环境信息: save.环境信息
        ? {
            时间: save.环境信息.时间,
            年: save.环境信息.年,
            月: save.环境信息.月,
            日: save.环境信息.日,
            时: save.环境信息.时,
            分: save.环境信息.分,
            大地点: save.环境信息.大地点,
            中地点: save.环境信息.中地点,
            小地点: save.环境信息.小地点,
            具体地点: save.环境信息.具体地点,
        }
        : undefined,
});

const injectSaveAndReload = async (page) => {
    await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
    await closeReleaseNotesIfOpen(page);
    await page.evaluate(async (payload) => {
        const req = indexedDB.open('WuxiaGameDB');
        const db = await new Promise((resolve, reject) => {
            req.onerror = () => reject(req.error);
            req.onsuccess = () => resolve(req.result);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('saves')) db.createObjectStore('saves', { keyPath: 'id', autoIncrement: true });
                if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
                if (!db.objectStoreNames.contains('image_assets')) db.createObjectStore('image_assets', { keyPath: 'id' });
            };
        });
        await new Promise((resolve, reject) => {
            const tx = db.transaction(['saves', 'save_summaries'], 'readwrite');
            const store = tx.objectStore('saves');
            const summaryStore = tx.objectStore('save_summaries');
            store.clear();
            summaryStore.clear();
            store.put(payload.save);
            summaryStore.put(payload.summary);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }, (() => {
        const save = makeDialogueFallbackSave();
        return { save, summary: makeSummary(save) };
    })());
    await page.reload({ waitUntil: 'networkidle' });
    await closeReleaseNotesIfOpen(page);
};

test('角色对话框只渲染完整引号对白，串入叙事会回落为旁白', async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
        localStorage.setItem('moranjianghu.releaseNotesSuppressDate', new Date().toISOString().slice(0, 10));
    });

    await injectSaveAndReload(page);
    await clickByTexts(page, ['本地游玩']);
    await clickByTexts(page, ['重入江湖', '读取进度', '继续游戏', '读取', '载入']);
    await page.waitForTimeout(700);
    await clickByTexts(page, ['对话框兜底测试', '9101', '杨培强']);
    await page.waitForTimeout(300);
    await clickByTexts(page, ['读取最新存档']);
    const confirmDialog = page.getByText('读取存档：杨培强').locator('xpath=ancestor::div[contains(@class,"fixed")][1]');
    const confirmLoad = confirmDialog.getByRole('button', { name: '读取' });
    await expect(confirmLoad).toBeVisible({ timeout: 5000 });
    await confirmLoad.click({ force: true });
    await expect(confirmDialog).toBeHidden({ timeout: 5000 });

    await expect(page.locator('.chat-character-name', { hasText: '杨培强' })).toHaveCount(1, { timeout: 10000 });
    await expect(page.locator('.chat-character-name', { hasText: '杨青儿' })).toHaveCount(1);
    await expect(page.locator('.chat-character-name', { hasText: '亨特' })).toHaveCount(1);
    await expect(page.locator('.chat-character-name', { hasText: '众人齐声' })).toHaveCount(0);

    const firstBubbleText = await page.locator('.chat-character-name', { hasText: '杨培强' })
        .locator('xpath=ancestor::div[contains(@class,"flex-col")]/following-sibling::div[1]')
        .first()
        .innerText();
    expect(firstBubbleText.trim()).toBe('“弟子，领命。”');

    const narratorText = await page.locator('.narrator-renderer').allInnerTexts();
    expect(narratorText.join('\n')).toContain('风，渐渐停了。');
    expect(narratorText.join('\n')).toContain('铅灰色的云层开始散去。');
    expect(narratorText.join('\n')).toContain('“遵命！”');
    expect(narratorText.join('\n')).toContain('夜店里的灯光晃了一下。');
    expect(narratorText.join('\n')).toContain('他只是缓缓伸出右手，把冰冷的杯壁贴近嘴唇。');
});
