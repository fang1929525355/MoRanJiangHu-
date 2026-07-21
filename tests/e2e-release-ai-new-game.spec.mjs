import { test, expect } from '@playwright/test';

const aiBaseUrl = process.env.MORAN_E2E_AI_BASE_URL?.trim();
const aiApiKey = process.env.MORAN_E2E_AI_API_KEY?.trim();
const aiModel = process.env.MORAN_E2E_AI_MODEL?.trim();

const requireAiConfig = () => {
  if (!aiBaseUrl || !aiApiKey || !aiModel) {
    throw new Error('Missing MORAN_E2E_AI_BASE_URL, MORAN_E2E_AI_API_KEY, or MORAN_E2E_AI_MODEL');
  }
};

const clickVisible = async (page, candidates, timeout = 5000) => {
  for (const candidate of candidates) {
    const locator = page.getByRole('button', { name: candidate }).first();
    if (await locator.count() && await locator.isVisible().catch(() => false)) {
      await locator.click({ timeout, force: true });
      return true;
    }
  }
  for (const candidate of candidates) {
    const locator = page.getByText(candidate, { exact: false }).first();
    if (await locator.count() && await locator.isVisible().catch(() => false)) {
      await locator.click({ timeout, force: true });
      return true;
    }
  }
  return false;
};

const putSetting = async (page, key, value) => {
  await page.evaluate(async ({ key, value }) => {
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
      const tx = db.transaction(['settings'], 'readwrite');
      tx.objectStore('settings').put({
        key,
        value,
        version: 2,
        category: key === 'api_settings' ? 'api' : 'e2e',
        updatedAt: Date.now()
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, { key, value });
};

const readSaveCount = async (page) => page.evaluate(async () => {
  const req = indexedDB.open('WuxiaGameDB');
  const db = await new Promise((resolve, reject) => {
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
  const saves = await new Promise((resolve, reject) => {
    const tx = db.transaction(['saves'], 'readonly');
    const request = tx.objectStore('saves').getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return saves.length;
});

test('release smoke: new save can start with configured AI endpoint', async ({ page }) => {
  requireAiConfig();
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const aiRequests = [];
  const aiBase = aiBaseUrl.replace(/\/+$/u, '');
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith(aiBase) && url.includes('/chat/completions')) {
      aiRequests.push(url);
    }
  });

  await page.addInitScript(() => {
    localStorage.setItem('moranjianghu.releaseNotesSuppressDate', new Date().toISOString().slice(0, 10));
  });
  await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });

  const apiSettings = {
    activeConfigId: 'release-e2e-ai',
    configs: [{
      id: 'release-e2e-ai',
      名称: 'Release E2E AI',
      供应商: 'openai_compatible',
      协议覆盖: 'openai',
      baseUrl: aiBaseUrl,
      apiKey: aiApiKey,
      model: aiModel,
      maxTokens: 1200,
      temperature: 0.2,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }],
    功能模型占位: {
      主剧情使用模型: aiModel,
      世界演变功能启用: false,
      规划分析功能启用: false,
      地图生成功能启用: false,
      地图自动更新独立模型开关: false,
      文生图功能启用: false,
      NPC生图启用: false,
      场景生图启用: false,
      物品生图启用: false
    }
  };
  await putSetting(page, 'api_settings', apiSettings);
  await page.evaluate((settings) => {
    localStorage.setItem('moranjianghu.apiConfig.localMirror.v1', JSON.stringify(settings));
  }, apiSettings);

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: '墨色江湖' })).toBeVisible({ timeout: 15000 });
  expect(await clickVisible(page, ['本地游玩'])).toBe(true);
  await page.waitForTimeout(500);
  expect(await clickVisible(page, ['踏入江湖', '新的江湖', '开始游戏', '新建存档', '初入江湖'])).toBe(true);

  await expect(page.getByText(/1\s*\/\s*6|Progress/i).first()).toBeVisible({ timeout: 15000 });
  await clickVisible(page, ['无限流']);
  for (let i = 0; i < 5; i += 1) {
    const ok = await clickVisible(page, ['下一步 →', '下一步']);
    expect(ok).toBe(true);
    await page.waitForTimeout(350);
    if (i === 1) {
      const visibleInputs = page.locator('input:visible');
      await expect(visibleInputs.first()).toBeVisible({ timeout: 10000 });
      await visibleInputs.first().fill('端测轮回者');
      await page.waitForTimeout(150);
    }
    if (i === 2) {
      const partnerInput = page.getByPlaceholder(/同伴名号|同伴姓名/).first();
      if (await partnerInput.count() && await partnerInput.isVisible().catch(() => false)) {
        await partnerInput.fill('端测队友');
      }
    }
  }

  await expect(page.getByRole('button', { name: /开启世界推演|一键生成/ }).first()).toBeVisible({ timeout: 10000 });
  await clickVisible(page, ['开启世界推演', '一键生成 (世界+剧情)']);
  await page.waitForTimeout(500);
  await clickVisible(page, ['开始生成', '确认生成', '继续创建']);

  await expect.poll(async () => aiRequests.length, {
    timeout: 90000,
    message: 'expected the new-game flow to call the configured AI chat endpoint'
  }).toBeGreaterThan(0);

  await expect.poll(async () => {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const saveCount = await readSaveCount(page).catch(() => 0);
    return saveCount > 0
      || bodyText.includes('背包')
      || bodyText.includes('社交')
      || bodyText.includes('江湖行囊')
      || bodyText.includes('江湖谱')
      || bodyText.includes('保存进度')
      || bodyText.includes('输入你的行动');
  }, {
    timeout: 180000,
    intervals: [2000, 5000, 10000],
    message: 'expected the AI new-game flow to enter game UI or create a save'
  }).toBe(true);
});
