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
};

const closeBlockingOverlaysIfOpen = async (page) => {
    await closeReleaseNotesIfOpen(page);
    const lineageModalTitle = page.getByText('旧存档正在转换为新谱系', { exact: false }).first();
    await lineageModalTitle.waitFor({ state: 'visible', timeout: 2500 }).catch(() => {});
    if (await lineageModalTitle.isVisible().catch(() => false)) {
        const closeButton = page.getByRole('button', { name: /^关闭$/ }).first();
        await closeButton.click({ timeout: 3000, force: true });
        await lineageModalTitle.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
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

const loadSingleSaveSeries = async (page) => {
    const card = page.locator('div.cursor-pointer', { hasText: '点击本系列会直接读取最新存档' }).first();
    await card.click({ timeout: 10000, position: { x: 24, y: 80 }, force: true });
    await page.getByRole('button', { name: /^读取$/ }).last().click({ timeout: 5000, force: true });
};

const makePlaceholderNpcSave = () => {
    const save = structuredClone(baseSave);
    save.id = 902601;
    save.类型 = 'manual';
    save.时间戳 = Date.now();
    save.元数据 = {
        ...(save.元数据 || {}),
        名称: 'NPC占位名合并端到端测试',
        历史记录条数: Array.isArray(save.历史记录) ? save.历史记录.length : 0,
        历史记录是否裁剪: false,
        现实保存时间戳: save.时间戳,
        现实保存时间ISO: new Date(save.时间戳).toISOString()
    };
    save.社交 = [
        {
            id: 'npc_placeholder_woman',
            姓名: '黑衣女人',
            性别: '女',
            身份: '潜入永安宫的黑衣女子',
            简介: '在永安宫偏殿救下主角的黑衣女人。',
            当前位置: '永安宫偏殿',
            位置路径: '京城 > 永安宫 > 偏殿',
            是否在场: true,
            是否队友: false,
            是否主要角色: false,
            好感度: 12,
            关系状态: '初识',
            记忆: [{ 内容: '在永安宫偏殿与主角照面。', 时间: '0001:01:01:08:00' }]
        },
        {
            id: 'npc_linyuan',
            姓名: '林婉儿',
            性别: '女',
            身份: '潜入永安宫的黑衣女子',
            简介: '林婉儿正是此前在永安宫偏殿出现的黑衣女人。',
            当前位置: '永安宫偏殿',
            位置路径: '京城 > 永安宫 > 偏殿',
            是否在场: true,
            是否队友: false,
            是否主要角色: false,
            好感度: 16,
            关系状态: '初识',
            记忆: [{ 内容: '向主角承认自己名叫林婉儿。', 时间: '0001:01:01:08:10' }]
        },
        {
            id: 'npc_yongan_eunuch',
            姓名: '永安宫掌事太监',
            性别: '男',
            身份: '永安宫掌事太监',
            简介: '负责迎送秀女入宫的掌事太监。',
            当前位置: '永安宫',
            位置路径: '京城 > 永安宫',
            是否在场: true,
            是否队友: false,
            是否主要角色: false,
            好感度: 0,
            关系状态: '初识',
            记忆: [{ 内容: '在永安宫门前清点名册。', 时间: '0001:01:01:09:00' }]
        },
        {
            id: 'npc_xiaoduo',
            姓名: '萧铎',
            性别: '男',
            身份: '永安宫掌事太监',
            简介: '萧铎就是永安宫掌事太监，负责迎送秀女入宫。',
            当前位置: '永安宫',
            位置路径: '京城 > 永安宫',
            是否在场: true,
            是否队友: false,
            是否主要角色: false,
            好感度: 2,
            关系状态: '初识',
            记忆: [{ 内容: '报上姓名萧铎。', 时间: '0001:01:01:09:05' }]
        }
    ];
    return save;
};

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
                if (!db.objectStoreNames.contains('save_summaries')) db.createObjectStore('save_summaries', { keyPath: 'id' });
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
            store.put(payload);
            summaryStore.put({
                id: payload.id,
                类型: payload.类型 === 'auto' ? 'auto' : 'manual',
                时间戳: Math.max(0, Math.floor(Number(payload.时间戳) || 0)),
                元数据: payload.元数据,
                游戏初始时间: payload.游戏初始时间,
                角色数据: payload.角色数据 ? {
                    姓名: payload.角色数据.姓名,
                    境界: payload.角色数据.境界,
                    境界层级: payload.角色数据.境界层级
                } : undefined,
                环境信息: payload.环境信息 ? {
                    时间: payload.环境信息.时间,
                    年: payload.环境信息.年,
                    月: payload.环境信息.月,
                    日: payload.环境信息.日,
                    时: payload.环境信息.时,
                    分: payload.环境信息.分,
                    大地点: payload.环境信息.大地点,
                    中地点: payload.环境信息.中地点,
                    小地点: payload.环境信息.小地点,
                    具体地点: payload.环境信息.具体地点
                } : undefined
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }, makePlaceholderNpcSave());
    await page.reload({ waitUntil: 'networkidle' });
    await closeBlockingOverlaysIfOpen(page);
};

test('占位名 NPC 后续得名后在真实社交面板中保持单一档案', async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
        localStorage.setItem('moranjianghu.releaseNotesSuppressDate', new Date().toISOString().slice(0, 10));
    });

    await injectSaveAndReload(page);
    await expect.poll(() => clickByTexts(page, ['本地游玩'])).toBe(true);
    await expect.poll(() => clickByTexts(page, ['重入江湖', '读取进度', '继续游戏', '读取', '载入'])).toBe(true);
    await loadSingleSaveSeries(page);
    await page.waitForTimeout(1800);
    await expect.poll(() => clickByTexts(page, ['江湖谱', '社交'])).toBe(true);

    await expect(page.locator('.social-roster-card__name').first()).toBeVisible({ timeout: 10000 });
    const rosterNames = await page.locator('.social-roster-card__name').allInnerTexts();

    expect(rosterNames).toContain('林婉儿');
    expect(rosterNames).toContain('萧铎');
    expect(rosterNames).not.toContain('黑衣女人');
    expect(rosterNames).not.toContain('永安宫掌事太监');
    expect(rosterNames.filter((name) => name === '林婉儿')).toHaveLength(1);
    expect(rosterNames.filter((name) => name === '萧铎')).toHaveLength(1);
});
