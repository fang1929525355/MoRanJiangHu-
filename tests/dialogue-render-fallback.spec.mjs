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

const screenshotDialogueRaw = [
    '<正文>',
    '折生的话音刚落，房间里那股原本还算欢快的邀功气氛，极其突兀地停滞了一瞬。',
    '',
    '【萧蒲童子】“哈？”',
    '',
    '萧蒲童子终于反应过来了，她指着地上还在不停扭动、流着口水的苏清月，爆发出一阵极其夸张的大笑。',
    '',
    '【萧蒲童子】“民女？主人，你是不是昨晚睡觉把脑子给压扁了？谁家民女大半夜的在荒郊野外的破庙里御剑飞行啊！还拿着把冷飕飕的破剑到处乱砍！”',
    '',
    '葛叶御前松开踩在苏清月臀部上的脚，双手抱胸，踩着高齿木履往前走了一步。',
    '',
    '【葛叶御前】“妾身看你不仅抠门，眼神也不太好使。”',
    '</正文>',
    '<短期记忆>折生与萧蒲童子、葛叶御前交谈。</短期记忆>'
].join('\n');

const makeScreenshotDialogueSave = () => {
    const save = structuredClone(baseSave);
    save.id = 9102;
    save.类型 = 'manual';
    save.时间戳 = 1713772900000;
    save.元数据 = {
        ...(save.元数据 || {}),
        名称: '短对白气泡回归测试',
        现实保存时间戳: 1713772900000,
        现实保存时间ISO: new Date(1713772900000).toISOString()
    };
    save.历史记录 = [
        {
            role: 'user',
            content: '端到端检查短对白气泡拆分'
        },
        {
            role: 'assistant',
            content: 'Structured Response',
            rawJson: screenshotDialogueRaw,
            structuredResponse: {
                logs: [{ sender: '旁白', text: '等待编辑原文后重新解析。' }],
                shortTerm: '等待重新解析。'
            }
        }
    ];
    return save;
};

const makeRerollSave = () => {
    const save = structuredClone(baseSave);
    save.id = 9103;
    save.类型 = 'manual';
    save.时间戳 = 1713773000000;
    save.元数据 = {
        ...(save.元数据 || {}),
        名称: '重ROLL存档回归测试',
        现实保存时间戳: 1713773000000,
        现实保存时间ISO: new Date(1713773000000).toISOString()
    };
    save.历史记录 = [
        {
            role: 'user',
            content: '这条输入应在重ROLL后回填'
        },
        {
            role: 'assistant',
            content: 'Structured Response',
            rawJson: '<正文>\n【旁白】这一回合稍后会被回档。\n</正文>\n<短期记忆>回档测试。</短期记忆>',
            structuredResponse: {
                logs: [{ sender: '旁白', text: '这一回合稍后会被回档。' }],
                shortTerm: '回档测试。'
            }
        }
    ];
    return save;
};

const makePreservedAutoSave = () => {
    const save = structuredClone(baseSave);
    save.id = 9199;
    save.类型 = 'auto';
    save.时间戳 = 1713772999000;
    save.元数据 = {
        ...(save.元数据 || {}),
        名称: '上一轮有效自动存档',
        现实保存时间戳: 1713772999000,
        现实保存时间ISO: new Date(1713772999000).toISOString()
    };
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

const injectSaveAndReload = async (page, primarySave = makeDialogueFallbackSave(), extraSaves = [], gameSettings = null) => {
    await page.goto('http://127.0.0.1:4173', { waitUntil: 'domcontentloaded' });
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
            const stores = payload.gameSettings ? ['saves', 'save_summaries', 'settings'] : ['saves', 'save_summaries'];
            const tx = db.transaction(stores, 'readwrite');
            const store = tx.objectStore('saves');
            const summaryStore = tx.objectStore('save_summaries');
            store.clear();
            summaryStore.clear();
            for (const save of payload.saves) {
                store.put(save);
                summaryStore.put(payload.summaries.find((summary) => summary.id === save.id));
            }
            if (payload.gameSettings) {
                tx.objectStore('settings').put({
                    key: 'game_settings',
                    value: payload.gameSettings,
                    version: 2,
                    updatedAt: Date.now(),
                    category: 'gameplay'
                });
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }, {
        saves: [primarySave, ...extraSaves],
        summaries: [primarySave, ...extraSaves].map(makeSummary),
        gameSettings
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
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

test('编辑玩家反馈原文后，同角色的两段短对白都渲染为独立气泡', async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
        localStorage.setItem('moranjianghu.releaseNotesSuppressDate', new Date().toISOString().slice(0, 10));
    });

    const save = makeScreenshotDialogueSave();
    await injectSaveAndReload(page, save, [], {
        启用严格正文对白格式: false,
        启用行动选项: false
    });
    await clickByTexts(page, ['本地游玩']);
    await clickByTexts(page, ['重入江湖', '读取进度', '继续游戏', '读取', '载入']);
    await page.waitForTimeout(700);
    await clickByTexts(page, ['短对白气泡回归测试', '9102']);
    await page.waitForTimeout(300);
    await clickByTexts(page, ['读取最新存档']);
    const confirmDialog = page.getByText('读取存档：杨培强').locator('xpath=ancestor::div[contains(@class,"fixed")][1]');
    await confirmDialog.getByRole('button', { name: '读取' }).click({ force: true });
    await expect(confirmDialog).toBeHidden({ timeout: 5000 });

    await page.locator('button[title="查看/编辑原文"]').click();
    await expect(page.locator('textarea.h-96')).toBeVisible();
    await page.getByRole('button', { name: '保存并重解析' }).click();

    const xiaoPuBubbles = page.locator('.chat-character-name', { hasText: '萧蒲童子' });
    await expect(xiaoPuBubbles).toHaveCount(2, { timeout: 10000 });
    await expect(page.locator('.chat-character-name', { hasText: '葛叶御前' })).toHaveCount(1);
    const secondBubbleText = await xiaoPuBubbles.nth(1)
        .locator('xpath=ancestor::div[contains(@class,"flex-col")]/following-sibling::div[1]')
        .first()
        .innerText();
    expect(secondBubbleText).toContain('民女？主人，你是不是昨晚睡觉把脑子给压扁了？');
    expect((await page.locator('.narrator-renderer').allInnerTexts()).join('\n')).toContain('萧蒲童子终于反应过来了');
});

test('重ROLL回档后保留上一轮有效自动存档', async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
        localStorage.setItem('moranjianghu.releaseNotesSuppressDate', new Date().toISOString().slice(0, 10));
    });

    const save = makeRerollSave();
    const preservedAutoSave = makePreservedAutoSave();
    await injectSaveAndReload(page, save, [preservedAutoSave]);
    await clickByTexts(page, ['本地游玩']);
    await clickByTexts(page, ['重入江湖', '读取进度', '继续游戏', '读取', '载入']);
    await page.waitForTimeout(700);
    await clickByTexts(page, ['重ROLL存档回归测试', '9103']);
    await page.waitForTimeout(300);
    await clickByTexts(page, ['读取最新存档']);
    const confirmDialog = page.getByText('读取存档：杨培强').locator('xpath=ancestor::div[contains(@class,"fixed")][1]');
    await confirmDialog.getByRole('button', { name: '读取' }).click({ force: true });
    await expect(confirmDialog).toBeHidden({ timeout: 5000 });

    const rerollButton = page.locator('button[title="重ROLL：回档到上一轮并回填输入"]');
    await expect(rerollButton).toBeEnabled({ timeout: 10000 });
    await rerollButton.click();
    await expect(page.locator('input[placeholder="输入你的行动..."]')).toHaveValue('这条输入应在重ROLL后回填');
    await page.waitForTimeout(500);

    const preserved = await page.evaluate(async () => {
        const req = indexedDB.open('WuxiaGameDB');
        const db = await new Promise((resolve, reject) => {
            req.onerror = () => reject(req.error);
            req.onsuccess = () => resolve(req.result);
        });
        return new Promise((resolve, reject) => {
            const request = db.transaction('saves', 'readonly').objectStore('saves').get(9199);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    });
    expect(preserved).not.toBeNull();
    expect(preserved.元数据.名称).toBe('上一轮有效自动存档');
});
