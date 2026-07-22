import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';

const zip = unzipSync(readFileSync('.tmp-release-assets/WuXia_Save_Data.zip'));
const saveName = Object.keys(zip).find((name) => name.startsWith('saves/') && name.endsWith('.json'));
const baseSave = JSON.parse(strFromU8(zip[saveName]));

const remoteImageUrl = 'https://image.bacon159.pp.ua/file/e2e-existing-character-image.png';
const blockedImageEndpoint = 'http://127.0.0.1:9/v1/images/generations';

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

const buildImageRecord = (id, composition) => ({
  id,
  状态: 'success',
  构图: composition,
  图片URL: remoteImageUrl,
  本地路径: 'wuxia-asset://missing-local-cache',
  生成时间: Date.now()
});

const buildSaveWithExistingRemoteImages = () => {
  const save = JSON.parse(JSON.stringify(baseSave));
  const playerRecord = buildImageRecord('e2e-player-avatar', '头像');
  save.角色数据 = {
    ...save.角色数据,
    头像图片URL: '',
    最近生图结果: playerRecord,
    图片档案: {
      ...(save.角色数据?.图片档案 || {}),
      最近生图结果: playerRecord,
      生图历史: [playerRecord],
      已选头像图片ID: playerRecord.id
    }
  };

  const npcRecord = buildImageRecord('e2e-npc-avatar', '头像');
  const originalNpc = Array.isArray(save.社交) && save.社交.length > 0 ? save.社交[0] : {};
  save.社交 = [{
    ...originalNpc,
    id: originalNpc.id || 'e2e-main-npc',
    姓名: originalNpc.姓名 || '端到端角色',
    性别: originalNpc.性别 || '女',
    是否主要角色: true,
    头像图片URL: '',
    最近生图结果: npcRecord,
    图片档案: {
      ...(originalNpc.图片档案 || {}),
      最近生图结果: npcRecord,
      生图历史: [npcRecord],
      已选头像图片ID: npcRecord.id
    }
  }];
  return save;
};

const buildSaveWithNpcAvatarMissing = () => {
  const save = JSON.parse(JSON.stringify(baseSave));
  const playerRecord = buildImageRecord('e2e-player-avatar', '头像');
  save.角色数据 = {
    ...save.角色数据,
    头像图片URL: '',
    最近生图结果: playerRecord,
    图片档案: {
      ...(save.角色数据?.图片档案 || {}),
      最近生图结果: playerRecord,
      生图历史: [playerRecord],
      已选头像图片ID: playerRecord.id
    }
  };

  const originalNpc = Array.isArray(save.社交) && save.社交.length > 0 ? save.社交[0] : {};
  save.社交 = [{
    ...originalNpc,
    id: originalNpc.id || 'e2e-missing-npc',
    姓名: originalNpc.姓名 || '待补头像角色',
    性别: originalNpc.性别 || '女',
    是否主要角色: true,
    头像图片URL: '',
    最近生图结果: undefined,
    图片档案: {
      ...(originalNpc.图片档案 || {}),
      最近生图结果: undefined,
      生图历史: [],
      已选头像图片ID: ''
    }
  }];
  return save;
};

const seedSaveAndSettings = async (page, save) => {
  await page.evaluate(async ({ save, blockedImageEndpoint }) => {
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
      const tx = db.transaction(['saves', 'settings'], 'readwrite');
      tx.objectStore('saves').put(save);
      tx.objectStore('settings').put({
        key: 'api_settings',
        value: {
          功能模型占位: {
            文生图功能启用: true,
            NPC生图启用: false,
            场景生图启用: false,
            物品生图启用: false,
            文生图后端类型: 'openai',
            文生图模型使用模型: 'e2e-image-model',
            文生图模型API地址: blockedImageEndpoint,
            文生图模型API密钥: 'e2e'
          }
        },
        version: 2,
        updatedAt: Date.now(),
        category: 'api'
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, { save, blockedImageEndpoint });
};

const openSeededSave = async (page) => {
  await page.reload({ waitUntil: 'networkidle' });
  await clickByTexts(page, ['重入江湖', '读取进度', '继续游戏', '读取', '载入']);
  await page.waitForTimeout(700);
  await clickByTexts(page, ['杨培强', '手动存档', 'manual']);
  await page.waitForTimeout(300);
  await clickByTexts(page, ['加载此存档', '读取此存档', '载入存档', '确认读取', '读取', '进入江湖']);
  await page.waitForTimeout(3500);
};

const readLatestSaveState = async (page) => page.evaluate(async () => {
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
  const latest = saves.sort((a, b) => Number(b.时间戳 || 0) - Number(a.时间戳 || 0))[0] || {};
  return {
    playerHistoryCount: latest?.角色数据?.图片档案?.生图历史?.length || 0,
    npcHistoryCount: latest?.社交?.[0]?.图片档案?.生图历史?.length || 0,
    npcLatestStatus: latest?.社交?.[0]?.图片档案?.最近生图结果?.状态 || ''
  };
});

const readClientDiagnostics = async (page) => page.evaluate(() => {
  const parseLogs = () => {
    try {
      return JSON.parse(localStorage.getItem('moranjianghu.diagnosticLogs') || '[]');
    } catch {
      return [];
    }
  };
  const prebootLogs = Array.isArray(window.__MORAN_PREBOOT_LOGS__)
    ? window.__MORAN_PREBOOT_LOGS__.map((entry) => Array.isArray(entry?.values) ? entry.values.join('\n') : '')
    : [];
  const diagnosticLogs = parseLogs().map((entry) => `${entry?.message || ''}\n${entry?.detail || ''}`);
  return {
    overlayText: document.querySelector('#moran-preboot-error-overlay')?.textContent || '',
    prebootLogs,
    diagnosticLogs
  };
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem('moranjianghu.releaseNotesSuppressDate', new Date().toISOString().slice(0, 10));
  });
  await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
});

test('automatic character image generation stays off when existing remote images are present', async ({ page }) => {
  test.setTimeout(60000);
  const imageRequests = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('127.0.0.1:9') || url.includes('/v1/images/generations')) {
      imageRequests.push(url);
    }
  });

  await seedSaveAndSettings(page, buildSaveWithExistingRemoteImages());
  await openSeededSave(page);

  const state = await readLatestSaveState(page);

  expect(imageRequests).toEqual([]);
  expect(state.playerHistoryCount).toBe(1);
  expect(state.npcHistoryCount).toBe(1);
});

test('automatic npc image generation stays off when npc switch is disabled', async ({ page }) => {
  test.setTimeout(60000);
  const imageRequests = [];
  const pageErrors = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('127.0.0.1:9') || url.includes('/v1/images/generations')) {
      imageRequests.push(url);
    }
  });
  page.on('pageerror', (error) => {
    pageErrors.push(String(error));
  });

  await seedSaveAndSettings(page, buildSaveWithNpcAvatarMissing());
  await openSeededSave(page);

  const state = await readLatestSaveState(page);
  const diagnostics = await readClientDiagnostics(page);
  const diagnosticText = [
    diagnostics.overlayText,
    ...diagnostics.prebootLogs,
    ...diagnostics.diagnosticLogs,
    ...pageErrors
  ].join('\n');

  expect(imageRequests).toEqual([]);
  expect(state.playerHistoryCount).toBe(1);
  expect(state.npcHistoryCount).toBe(0);
  expect(state.npcLatestStatus).toBe('');
  expect(diagnostics.overlayText).toBe('');
  expect(diagnosticText).not.toContain('preboot unhandledrejection');
  expect(diagnosticText).not.toContain('unhandledrejection');
  expect(diagnosticText).not.toContain('图片生成响应无法解析');
  expect(diagnosticText).not.toContain('File not found');
});
