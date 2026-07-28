import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const baseSave = JSON.parse(readFileSync('e2e/fixtures/desktop-compact-save.json', 'utf8'));

const compactOptions = [
    '上前询问掌柜昨夜城中异象的来龙去脉',
    '暂不声张，先观察四周是否有可疑人物',
    '取出地图，对照当前地点规划下一段行程',
    '邀请杨青儿同行前往城西旧宅探查',
    '检查随身物品，确认药品与兵器是否齐备',
    '向附近住客打听最近失踪人口的消息',
    '返回房间整理线索并记录关键人物关系',
    '前往集市购买干粮与夜间照明用的火折子',
    '拜访城中镖局，询问是否接到异常委托',
    '沿河岸搜索可能遗留的脚印与衣物碎片',
    '在客栈大厅等待，观察谁会主动前来接触',
    '写信通知旧友，请他协助调查城外山道',
    '先休息片刻，恢复精力后再继续行动',
    '直接前往衙门，将掌握的线索告知捕头',
    '隐去身份独自夜探，不让其他人卷入危险',
    '重新梳理时间线，寻找证词之间的矛盾之处',
    '去药铺询问近期是否有人大量购买迷药',
    '留在原地继续修炼，等待新的江湖消息',
];

const closeReleaseNotesIfOpen = async (page) => {
    const closeButton = page.locator('button[aria-label="关闭更新日志"]');
    await closeButton.waitFor({ state: 'visible', timeout: 2500 }).catch(() => {});
    if (await closeButton.count() && await closeButton.first().isVisible().catch(() => false)) {
        await closeButton.first().click({ timeout: 3000, force: true });
    }
};

const clickByTexts = async (page, texts) => {
    for (const text of texts) {
        const button = page.getByRole('button', { name: new RegExp(text) }).first();
        if (await button.count() && await button.isVisible().catch(() => false)) {
            await button.click({ timeout: 5000, force: true });
            return true;
        }
        const locator = page.getByText(text, { exact: false }).first();
        if (await locator.count() && await locator.isVisible().catch(() => false)) {
            await locator.click({ timeout: 5000, force: true });
            return true;
        }
    }
    return false;
};

const makeCompactLayoutSave = () => {
    const save = structuredClone(baseSave);
    save.id = 13660768;
    save.类型 = 'manual';
    save.时间戳 = 1785250000000;
    save.元数据 = {
        ...(save.元数据 || {}),
        名称: '1366短屏适配验证',
        现实保存时间戳: 1785250000000,
        历史记录条数: 2,
        历史记录是否裁剪: false,
    };
    save.历史记录 = [
        { role: 'user', content: '检查短屏布局。' },
        {
            role: 'assistant',
            content: 'Structured Response',
            structuredResponse: {
                logs: [
                    {
                        sender: '旁白',
                        text: '暮色落在客栈檐角，厅中人声渐低。你将沿途所得线索逐一铺开，准备决定下一步行动。',
                    },
                ],
                shortTerm: '正在客栈整理调查线索。',
                action_options: compactOptions,
            },
        },
    ];
    return save;
};

const injectSaveAndReload = async (page, targetUrl) => {
    await page.goto(targetUrl, { waitUntil: 'networkidle' });
    await closeReleaseNotesIfOpen(page);
    await page.evaluate(async (payload) => {
        const request = indexedDB.open('WuxiaGameDB');
        const db = await new Promise((resolve, reject) => {
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
        await new Promise((resolve, reject) => {
            const transaction = db.transaction(['saves', 'save_summaries'], 'readwrite');
            transaction.objectStore('saves').clear();
            transaction.objectStore('save_summaries').clear();
            transaction.objectStore('saves').put(payload);
            transaction.objectStore('save_summaries').put({
                id: payload.id,
                类型: payload.类型,
                时间戳: payload.时间戳,
                元数据: payload.元数据,
                游戏初始时间: payload.游戏初始时间,
                角色数据: payload.角色数据,
                环境信息: payload.环境信息,
            });
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
        db.close();
    }, makeCompactLayoutSave());
    await page.reload({ waitUntil: 'networkidle' });
    await closeReleaseNotesIfOpen(page);
};

const loadCompactGame = async (page, viewport) => {
    test.setTimeout(60000);
    const targetUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173';
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
        localStorage.setItem('moranjianghu.releaseNotesSuppressDate', new Date().toISOString().slice(0, 10));
    });

    await injectSaveAndReload(page, targetUrl);
    await expect.poll(() => clickByTexts(page, ['本地游玩'])).toBe(true);
    await expect.poll(() => clickByTexts(page, ['重入江湖', '读取进度', '继续游戏', '读取', '载入'])).toBe(true);

    const saveCard = page.locator('div.cursor-pointer', { hasText: '点击本系列会直接读取最新存档' }).first();
    await expect(saveCard).toBeVisible({ timeout: 10000 });
    await saveCard.click({ position: { x: 24, y: 80 }, force: true });

    const confirmReadButton = page.getByRole('button', { name: /^读取$/ }).last();
    if (!await confirmReadButton.isVisible().catch(() => false)) {
        const latestSaveButton = page.getByRole('button', { name: '读取最新存档' });
        await expect(latestSaveButton).toBeVisible({ timeout: 5000 });
        await latestSaveButton.click({ timeout: 5000, force: true });
    }
    await expect(confirmReadButton).toBeVisible({ timeout: 5000 });
    await confirmReadButton.click({ timeout: 5000, force: true });
    await expect(page.locator('.desktop-quick-actions')).toBeVisible({ timeout: 10000 });
};

test('1366×768 桌面端保持正文、选项和菜单均可用', async ({ page }) => {
    await loadCompactGame(page, { width: 1366, height: 768 });

    const quickActions = page.locator('.desktop-quick-actions');
    const rightMenu = page.locator('.right-panel-menu-scroll');
    const systemActions = page.locator('.right-panel-system-actions');
    const bottomTicker = page.locator('.desktop-game-bottom-ticker');

    await expect(quickActions).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.desktop-quick-action-button')).toHaveCount(compactOptions.length);
    await expect(systemActions).toBeVisible();
    await expect(bottomTicker).toBeVisible();
    await expect(page.locator('.app-play-mode-badge')).toBeHidden();
    await expect(page.locator('.app-main-model-badge')).toBeHidden();

    const layout = await page.evaluate(() => {
        const quick = document.querySelector('.desktop-quick-actions');
        const menu = document.querySelector('.right-panel-menu-scroll');
        const system = document.querySelector('.right-panel-system-actions');
        const topbar = document.querySelector('.desktop-game-topbar');
        const ticker = document.querySelector('.desktop-game-bottom-ticker');
        const firstOption = document.querySelector('.desktop-quick-action-button');
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        const rootStyle = getComputedStyle(document.documentElement);
        const quickStyle = quick ? getComputedStyle(quick) : null;
        const firstOptionStyle = firstOption ? getComputedStyle(firstOption) : null;
        const rect = (element) => element?.getBoundingClientRect();
        return {
            viewport,
            bodyOverflowX: document.documentElement.scrollWidth - window.innerWidth,
            desktopGameTop: rootStyle.getPropertyValue('--desktop-game-top').trim(),
            desktopGameBottom: rootStyle.getPropertyValue('--desktop-game-bottom').trim(),
            quick: {
                clientHeight: quick?.clientHeight || 0,
                scrollHeight: quick?.scrollHeight || 0,
                overflowY: quickStyle?.overflowY || '',
                maxHeight: quickStyle?.maxHeight || '',
                touchAction: quickStyle?.touchAction || '',
                rect: rect(quick),
            },
            firstOptionStyle: {
                color: firstOptionStyle?.color || '',
                backgroundColor: firstOptionStyle?.backgroundColor || '',
                fontSize: firstOptionStyle?.fontSize || '',
                lineHeight: firstOptionStyle?.lineHeight || '',
                whiteSpace: firstOptionStyle?.whiteSpace || '',
            },
            menu: {
                overflowY: menu ? getComputedStyle(menu).overflowY : '',
                rect: rect(menu),
            },
            systemRect: rect(system),
            topbarRect: rect(topbar),
            tickerRect: rect(ticker),
            firstOptionRect: rect(firstOption),
        };
    });

    expect(layout.bodyOverflowX).toBeLessThanOrEqual(1);
    expect(layout.desktopGameTop).toBe('60px');
    expect(layout.desktopGameBottom).toBe('46px');
    expect(layout.quick.overflowY).toBe('auto');
    expect(layout.quick.maxHeight).not.toBe('none');
    expect(layout.quick.touchAction).toBe('pan-y');
    expect(layout.quick.clientHeight).toBeLessThanOrEqual(128);
    expect(layout.quick.scrollHeight).toBeGreaterThan(layout.quick.clientHeight);
    expect(layout.firstOptionStyle.fontSize).toBe('12px');
    expect(layout.firstOptionStyle.whiteSpace).toBe('normal');
    expect(layout.firstOptionStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(layout.menu.overflowY).toBe('auto');
    expect(layout.topbarRect.height).toBe(48);
    expect(layout.tickerRect.height).toBe(30);
    expect(layout.firstOptionRect.top).toBeGreaterThanOrEqual(layout.topbarRect.bottom);
    expect(layout.systemRect.bottom).toBeLessThanOrEqual(layout.tickerRect.top + 1);
    expect(layout.systemRect.top).toBeGreaterThan(layout.menu.rect.top);

    await quickActions.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
    });
    await expect.poll(() => quickActions.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    await page.screenshot({
        path: 'output/playwright/desktop-1366-compact-layout.png',
        fullPage: false,
    });
});

test('1366×900 常规桌面端不误用短屏压缩规则', async ({ page }) => {
    await loadCompactGame(page, { width: 1366, height: 900 });

    const layout = await page.evaluate(() => {
        const quick = document.querySelector('.desktop-quick-actions');
        const topbar = document.querySelector('.desktop-game-topbar');
        const ticker = document.querySelector('.desktop-game-bottom-ticker');
        const playModeBadge = document.querySelector('.app-play-mode-badge');
        const rootStyle = getComputedStyle(document.documentElement);
        const quickStyle = quick ? getComputedStyle(quick) : null;
        return {
            bodyOverflowX: document.documentElement.scrollWidth - window.innerWidth,
            desktopGameTop: rootStyle.getPropertyValue('--desktop-game-top').trim(),
            desktopGameBottom: rootStyle.getPropertyValue('--desktop-game-bottom').trim(),
            quickMaxHeight: quickStyle?.maxHeight || '',
            quickTouchAction: quickStyle?.touchAction || '',
            topbarHeight: topbar?.getBoundingClientRect().height || 0,
            tickerHeight: ticker?.getBoundingClientRect().height || 0,
            playModeDisplay: playModeBadge ? getComputedStyle(playModeBadge).display : '',
        };
    });

    expect(layout.bodyOverflowX).toBeLessThanOrEqual(1);
    expect(layout.desktopGameTop).toBe('75px');
    expect(layout.desktopGameBottom).toBe('57px');
    expect(layout.quickMaxHeight).toBe('none');
    expect(layout.quickTouchAction).toBe('pan-x');
    expect(layout.topbarHeight).toBe(58);
    expect(layout.tickerHeight).toBe(37);
    expect(layout.playModeDisplay).not.toBe('none');
});

test('390×844 移动端继续使用横向行动选项且无页面横向溢出', async ({ page }) => {
    await loadCompactGame(page, { width: 390, height: 844 });

    const layout = await page.evaluate(() => {
        const quick = document.querySelector('.desktop-quick-actions');
        const topbar = document.querySelector('.desktop-game-topbar');
        const ticker = document.querySelector('.desktop-game-bottom-ticker');
        const quickStyle = quick ? getComputedStyle(quick) : null;
        return {
            bodyOverflowX: document.documentElement.scrollWidth - window.innerWidth,
            quickClientWidth: quick?.clientWidth || 0,
            quickScrollWidth: quick?.scrollWidth || 0,
            quickOverflowX: quickStyle?.overflowX || '',
            quickOverflowY: quickStyle?.overflowY || '',
            quickMaxHeight: quickStyle?.maxHeight || '',
            topbarHeight: topbar?.getBoundingClientRect().height || 0,
            tickerDisplay: ticker ? getComputedStyle(ticker).display : '',
        };
    });

    expect(layout.bodyOverflowX).toBeLessThanOrEqual(1);
    expect(layout.quickOverflowX).toBe('auto');
    expect(layout.quickMaxHeight).toBe('none');
    expect(layout.quickScrollWidth).toBeGreaterThan(layout.quickClientWidth);
    expect(layout.topbarHeight).not.toBe(48);
    expect(layout.tickerDisplay).toBe('none');
});
