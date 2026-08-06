import { test, expect } from '@playwright/test';

const TARGET_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173';

const API_MIRROR_KEY = 'moranjianghu.apiConfig.localMirror.v1';
const RELEASE_NOTES_SUPPRESS_KEY = 'moranjianghu.releaseNotesSuppressDate';

// 崩溃特征：未选中小说时 record/dataset 同为 null，旧代码的 `record?.数据集ID === dataset?.id`
// 会因 undefined === undefined 成立而继续读取 record.题材，抛出该 TypeError。
const CRASH_SIGNATURE = /Cannot read properties of null \(reading '题材'\)|null is not an object.*题材/;

const makeApiConfigMirror = () => ({
    activeConfigId: null,
    configs: [],
    功能模型占位: {
        小说拆分功能启用: true,
        小说拆分独立模型开关: true,
        小说拆分使用模型: 'e2e-novel-split-model',
        小说拆分API地址: 'https://e2e.invalid/v1',
        小说拆分API密钥: 'e2e-novel-split-key',
    },
});

const collectPageErrors = (page) => {
    const errors = [];
    page.on('pageerror', (error) => {
        errors.push(`pageerror: ${error?.message || String(error)}`);
    });
    page.on('console', (message) => {
        if (message.type() !== 'error') return;
        errors.push(`console: ${message.text()}`);
    });
    return errors;
};

const prepareLandingPage = async (page) => {
    await page.addInitScript(
        ({ mirrorKey, mirrorValue, suppressKey }) => {
            localStorage.setItem(mirrorKey, JSON.stringify(mirrorValue));
            localStorage.setItem(suppressKey, new Date().toISOString().slice(0, 10));
        },
        {
            mirrorKey: API_MIRROR_KEY,
            mirrorValue: makeApiConfigMirror(),
            suppressKey: RELEASE_NOTES_SUPPRESS_KEY,
        }
    );
};

const openWorkbenchFromWorkshop = async (page) => {
    await page.goto(`${TARGET_URL}/?open=workshop`, { waitUntil: 'networkidle' });

    const workshopTitle = page.getByRole('heading', { name: '创意工坊' });
    await expect(workshopTitle).toBeVisible({ timeout: 15000 });

    const novelDecompositionEntry = page.getByRole('button', { name: /小说分解模块/ }).first();
    await expect(novelDecompositionEntry).toBeVisible({ timeout: 10000 });
    await novelDecompositionEntry.click({ timeout: 5000 });
};

const expectWorkbenchOpenedWithoutCrash = async (page, errors) => {
    const failureBanner = page.getByText('小说分解工作台打开失败', { exact: false });
    const workbenchTitle = page.getByRole('heading', { name: '小说分解工作台', exact: true });

    await expect(workbenchTitle).toBeVisible({ timeout: 20000 });
    await expect(failureBanner).toHaveCount(0);

    const crashErrors = errors.filter((item) => CRASH_SIGNATURE.test(item));
    expect(crashErrors, `不应出现空数据集崩溃：\n${crashErrors.join('\n')}`).toEqual([]);
};

test.describe('小说分解工作台空数据集回归', () => {
    test('未选中小说时打开工作台不触发 reading 题材 崩溃', async ({ page }) => {
        test.setTimeout(90000);
        const errors = collectPageErrors(page);

        await prepareLandingPage(page);
        await openWorkbenchFromWorkshop(page);
        await expectWorkbenchOpenedWithoutCrash(page, errors);

        // 未选中小说时，工作台应停留在空态而不是错误边界降级页
        await expect(page.locator('.novel-decomposition-workbench-backdrop')).toBeVisible();

        await page.screenshot({
            path: 'output/playwright/novel-decomposition-workbench-empty.png',
            fullPage: false,
        });
    });

    test('反复开关工作台仍保持稳定', async ({ page }) => {
        test.setTimeout(120000);
        const errors = collectPageErrors(page);

        await prepareLandingPage(page);
        await openWorkbenchFromWorkshop(page);
        await expectWorkbenchOpenedWithoutCrash(page, errors);

        const closeButton = page.getByRole('button', { name: '关闭', exact: true }).last();
        await closeButton.click({ timeout: 5000 });
        await expect(page.locator('.novel-decomposition-workbench-backdrop')).toHaveCount(0);

        await openWorkbenchFromWorkshop(page);
        await expectWorkbenchOpenedWithoutCrash(page, errors);
    });

    test('移动端窄屏打开工作台同样不崩溃', async ({ page }) => {
        test.setTimeout(90000);
        await page.setViewportSize({ width: 390, height: 844 });
        const errors = collectPageErrors(page);

        await prepareLandingPage(page);
        await openWorkbenchFromWorkshop(page);
        await expectWorkbenchOpenedWithoutCrash(page, errors);
    });
});
