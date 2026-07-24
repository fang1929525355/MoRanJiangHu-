import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const 读取请求体 = async (req: NodeJS.ReadableStream): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

const 执行NovelAI代理请求 = async (
  url: string,
  method: string,
  headers: Record<string, string>,
  body: Buffer
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> => {
  const upstreamHeaders = new Headers();
  Object.entries(headers).forEach(([key, value]) => {
    if (!value) return;
    if (/^(host|content-length|connection|accept-encoding)$/i.test(key)) return;
    upstreamHeaders.set(key, value);
  });

  const response = await fetch(url, {
    method: method.toUpperCase(),
    headers: upstreamHeaders,
    body: body.length ? body : undefined
  });
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  return {
    status: response.status,
    headers: responseHeaders,
    body: Buffer.from(await response.arrayBuffer())
  };
};

const handleNovelAiProxyRequest = async (
  req: any,
  res: any,
  next: () => void,
  logger: { error: (message: string) => void }
) => {
  if (!req.url) {
    next();
    return;
  }

  if (String(req.method || '').toUpperCase() === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    res.end();
    return;
  }

  try {
    const body = await 读取请求体(req);
    const targetUrl = `https://image.novelai.net${req.url}`;
    const headers: Record<string, string> = {};

    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') {
        headers[key] = value;
      }
    }

    const result = await 执行NovelAI代理请求(targetUrl, req.method || 'POST', headers, body);
    res.statusCode = result.status;
    Object.entries(result.headers).forEach(([key, value]) => {
      if (key.toLowerCase() === 'content-length') return;
      res.setHeader(key, value);
    });
    res.end(result.body);
  } catch (error: any) {
    logger.error(`[novelai-dev-proxy] ${error?.message || error}`);
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      error: 'NovelAI dev proxy failed',
      detail: error?.message || String(error)
    }));
  }
};

const handlePucodingImageProxyRequest = async (
  req: any,
  res: any,
  next: () => void,
  logger: { error: (message: string) => void }
) => {
  if (!req.url) {
    next();
    return;
  }

  try {
    if (!/^\/v1\/images\/(?:generations|edits)(?:[?#]|$)/i.test(req.url)) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Unsupported pucoding image proxy path' }));
      return;
    }

    const body = await 读取请求体(req);
    const targetUrl = `https://pucoding.com${req.url}`;
    const headers: Record<string, string> = {};
    const authorization = req.headers.authorization;
    const contentType = req.headers['content-type'];
    const accept = req.headers.accept;
    if (typeof authorization === 'string' && authorization.trim()) headers.authorization = authorization;
    if (typeof contentType === 'string' && contentType.trim()) headers['content-type'] = contentType;
    if (typeof accept === 'string' && accept.trim()) headers.accept = accept;

    const result = await 执行NovelAI代理请求(targetUrl, req.method || 'POST', headers, body);
    res.statusCode = result.status;
    Object.entries(result.headers).forEach(([key, value]) => {
      if (key.toLowerCase() === 'content-length') return;
      res.setHeader(key, value);
    });
    res.end(result.body);
  } catch (error: any) {
    logger.error(`[pucoding-image-dev-proxy] ${error?.message || error}`);
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      error: 'pucoding image dev proxy failed',
      detail: error?.message || String(error),
      cause: error?.cause?.message || error?.cause?.code || ''
    }));
  }
};

const isPrivateHostname = (hostname: string): boolean => {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower === '0.0.0.0') return true;
  if (/^127\./.test(lower) || /^10\./.test(lower) || /^192\.168\./.test(lower)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(lower)) return true;
  if (/^\[?::1\]?$/.test(lower)) return true;
  return false;
};

const isAllowedOpenAiImageProxyTarget = (value: string): boolean => {
  try {
    const url = new URL(value);
    return /^https:$/i.test(url.protocol) && !isPrivateHostname(url.hostname);
  } catch {
    return false;
  }
};

const handleOpenAiImageProxyRequest = async (
  req: any,
  res: any,
  next: () => void,
  logger: { error: (message: string) => void }
) => {
  if (!req.url) {
    next();
    return;
  }

  if (String(req.method || '').toUpperCase() === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    res.end();
    return;
  }

  try {
    const requestUrl = new URL(req.url, 'http://local-openai-image-proxy');
    const targetBase = String(requestUrl.searchParams.get('url') || '').trim().replace(/\/+$/, '');
    if (!targetBase || !isAllowedOpenAiImageProxyTarget(targetBase)) {
      res.statusCode = 400;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'OpenAI image proxy target URL is invalid or not allowed.' }));
      return;
    }

    // ?url= 模式：目标地址已编码在 query 参数中，跳过 pathname 路径白名单校验
    const isUrlMode = !!targetBase;

    if (!isUrlMode) {
      // ?provider= 模式：路径在 pathname 里，需要白名单校验
      const proxyPrefix = '/api/image-backend/openai-image-proxy';
      const pathPart = requestUrl.pathname.startsWith(proxyPrefix)
        ? requestUrl.pathname.slice(proxyPrefix.length) || '/'
        : requestUrl.pathname || '/';
      if (!/^\/(?:v1\/)?(?:images\/(?:generations|edits)|tasks\/[^/?#]+)$/i.test(pathPart)) {
        res.statusCode = 404;
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'Unsupported OpenAI image proxy path' }));
        return;
      }
    }

    const target = new URL(targetBase);
    const basePath = target.pathname.replace(/\/+$/, '');
    // ?url= 模式：目标地址已包含完整路径，直接使用
    if (!isUrlMode) {
      const proxyPrefix = '/api/image-backend/openai-image-proxy';
      const pathPart = requestUrl.pathname.startsWith(proxyPrefix)
        ? requestUrl.pathname.slice(proxyPrefix.length) || '/'
        : requestUrl.pathname || '/';
      const normalizedPath = basePath.endsWith('/v1') && pathPart.startsWith('/v1/')
        ? pathPart.replace(/^\/v1/i, '')
        : (pathPart.startsWith('/v1/') ? pathPart : `${basePath.endsWith('/v1') ? '' : '/v1'}${pathPart}`);
      target.pathname = `${basePath}${normalizedPath}`;
    }
    target.search = '';
    requestUrl.searchParams.forEach((value, key) => {
      if (key !== 'url') target.searchParams.append(key, value);
    });

    const method = String(req.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Method not allowed.' }));
      return;
    }
    const body = method === 'GET' ? Buffer.alloc(0) : await 读取请求体(req);
    const headers: Record<string, string> = {};
    const contentType = req.headers['content-type'];
    const authorization = req.headers.authorization;
    const accept = req.headers.accept;
    if (typeof authorization === 'string' && authorization.trim()) headers.authorization = authorization;
    if (typeof contentType === 'string' && contentType.trim()) headers['content-type'] = contentType;
    if (typeof accept === 'string' && accept.trim()) headers.accept = accept;

    const result = await 执行NovelAI代理请求(target.toString(), method, headers, body);
    res.statusCode = result.status;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    Object.entries(result.headers).forEach(([key, value]) => {
      if (key.toLowerCase() === 'content-length') return;
      res.setHeader(key, value);
    });
    res.end(result.body);
  } catch (error: any) {
    logger.error(`[openai-image-dev-proxy] ${error?.message || error}`);
    res.statusCode = 502;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      error: 'OpenAI image dev proxy failed',
      detail: error?.message || String(error)
    }));
  }
};

// 本地 dev / preview 下同域图片取回代理：对应生产 Worker 的 /api/image-backend/fetch-image
// 仅用于把"生图返回的远程图片 URL"取回为同源资源，避免浏览器跨域（CORS）失败。
const isAllowedFetchImageTarget = (value: string): boolean => {
  try {
    const url = new URL(value);
    return /^https?:$/i.test(url.protocol) && !isPrivateHostname(url.hostname);
  } catch {
    return false;
  }
};

const handleFetchImageProxyRequest = async (
  req: any,
  res: any,
  next: () => void,
  logger: { error: (message: string) => void }
) => {
  if (!req.url) {
    next();
    return;
  }

  if (String(req.method || '').toUpperCase() === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    res.end();
    return;
  }

  try {
    const requestUrl = new URL(req.url, 'http://local-fetch-image');
    const target = String(requestUrl.searchParams.get('url') || '').trim();
    if (!target || !isAllowedFetchImageTarget(target)) {
      res.statusCode = 400;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Invalid fetch-image target URL' }));
      return;
    }

    const upstream = await fetch(target, { headers: { Accept: 'image/*,*/*;q=0.8' } });
    if (!upstream.ok) {
      res.statusCode = upstream.status;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'fetch-image upstream failed', status: upstream.status }));
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.statusCode = 200;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.end(buf);
  } catch (error: any) {
    logger.error(`[fetch-image-dev-proxy] ${error?.message || error}`);
    res.statusCode = 502;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'fetch-image dev proxy failed', detail: error?.message || String(error) }));
  }
};

const isAllowedComfyProxyTarget = (value: string): boolean => {
  try {
    const url = new URL(value);
    return /^https?:$/i.test(url.protocol)
      && (
        /(^|\.)cnb\.run$/i.test(url.hostname)
        || /(^|\.)cnb\.space$/i.test(url.hostname)
        || process.env.CNB_SYNC_ALLOW_ANY_URL === 'true'
      );
  } catch {
    return false;
  }
};

const handleComfyUiProxyRequest = async (
  req: any,
  res: any,
  next: () => void,
  logger: { error: (message: string) => void }
) => {
  if (!req.url) {
    next();
    return;
  }

  if (String(req.method || '').toUpperCase() === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.end();
    return;
  }

  try {
    const requestUrl = new URL(req.url, 'http://local-comfy-proxy');
    const targetBase = String(requestUrl.searchParams.get('url') || '').trim().replace(/\/+$/, '');
    if (!targetBase || !isAllowedComfyProxyTarget(targetBase)) {
      res.statusCode = 400;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'ComfyUI proxy target URL is invalid or not allowed.' }));
      return;
    }

    const proxyPrefix = '/api/image-backend/comfyui-proxy';
    const pathPart = requestUrl.pathname.startsWith(proxyPrefix)
      ? requestUrl.pathname.slice(proxyPrefix.length) || '/'
      : requestUrl.pathname || '/';
    const target = new URL(targetBase);
    target.pathname = `${target.pathname.replace(/\/+$/, '')}/${pathPart.replace(/^\/+/, '')}`;
    target.search = '';
    requestUrl.searchParams.forEach((value, key) => {
      if (key !== 'url') target.searchParams.append(key, value);
    });

    const method = String(req.method || 'GET').toUpperCase();
    const body = method === 'GET' ? Buffer.alloc(0) : await 读取请求体(req);
    const headers: Record<string, string> = {};
    const contentType = req.headers['content-type'];
    const authorization = req.headers.authorization;
    const accept = req.headers.accept;
    if (typeof contentType === 'string' && contentType.trim()) headers['content-type'] = contentType;
    if (typeof authorization === 'string' && authorization.trim()) headers.authorization = authorization;
    if (typeof accept === 'string' && accept.trim()) headers.accept = accept;

    const result = await 执行NovelAI代理请求(target.toString(), method, headers, body);
    res.statusCode = result.status;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    Object.entries(result.headers).forEach(([key, value]) => {
      if (key.toLowerCase() === 'content-length') return;
      res.setHeader(key, value);
    });
    res.end(result.body);
  } catch (error: any) {
    logger.error(`[comfyui-dev-proxy] ${error?.message || error}`);
    res.statusCode = 502;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      error: 'ComfyUI dev proxy failed',
      detail: error?.message || String(error)
    }));
  }
};

const imageDevProxyPlugin = (): Plugin => ({
  name: 'image-dev-proxy',
  configurePreviewServer(server) {
    server.middlewares.use('/api/novelai', async (req, res, next) => {
      await handleNovelAiProxyRequest(req, res, next, server.config.logger);
    });
    server.middlewares.use('/api/pucoding-image', async (req, res, next) => {
      await handlePucodingImageProxyRequest(req, res, next, server.config.logger);
    });
    server.middlewares.use('/api/image-backend/openai-image-proxy', async (req, res, next) => {
      await handleOpenAiImageProxyRequest(req, res, next, server.config.logger);
    });
    server.middlewares.use('/api/image-backend/comfyui-proxy', async (req, res, next) => {
      await handleComfyUiProxyRequest(req, res, next, server.config.logger);
    });
    server.middlewares.use('/api/image-backend/fetch-image', async (req, res, next) => {
      await handleFetchImageProxyRequest(req, res, next, server.config.logger);
    });
  },
  configureServer(server) {
    server.middlewares.use('/api/novelai', async (req, res, next) => {
      await handleNovelAiProxyRequest(req, res, next, server.config.logger);
    });
    server.middlewares.use('/api/pucoding-image', async (req, res, next) => {
      await handlePucodingImageProxyRequest(req, res, next, server.config.logger);
    });
    server.middlewares.use('/api/image-backend/openai-image-proxy', async (req, res, next) => {
      await handleOpenAiImageProxyRequest(req, res, next, server.config.logger);
    });
    server.middlewares.use('/api/image-backend/comfyui-proxy', async (req, res, next) => {
      await handleComfyUiProxyRequest(req, res, next, server.config.logger);
    });
    server.middlewares.use('/api/image-backend/fetch-image', async (req, res, next) => {
      await handleFetchImageProxyRequest(req, res, next, server.config.logger);
    });
  }
});

const stripSameOriginAssetCrossoriginPlugin = (): Plugin => ({
  name: 'strip-same-origin-asset-crossorigin',
  apply: 'build',
  transformIndexHtml(html) {
    return html.replace(
      /(<(?:script|link)\b(?=[^>]*(?:src|href)="\/assets\/)[^>]*)\s+crossorigin(?=[\s>])/g,
      '$1'
    );
  }
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const productionBase = env.VITE_BASE_PATH || '/';
  return {
    base: mode === 'production' ? productionBase : '/',
    server: {
      port: 3000,
      host: '0.0.0.0',
      allowedHosts: ['.cnb.run', '.cnb.space', '.cnb.cool']
    },
    plugins: [react(), imageDevProxyPlugin(), stripSameOriginAssetCrossoriginPlugin()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    build: {
      chunkSizeWarningLimit: 2500,
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalizedId = id.replace(/\\/g, '/');
 
            if (normalizedId.includes('/node_modules/')) {
              if (
                normalizedId.includes('/react/') ||
                normalizedId.includes('/react-dom/') ||
                normalizedId.includes('/scheduler/')
              ) {
                return 'react-vendor';
              }
              if (normalizedId.includes('/@capacitor/')) {
                return 'capacitor-vendor';
              }
              if (normalizedId.includes('/fflate/')) {
                return 'fflate-vendor';
              }
              if (normalizedId.includes('/@google/genai/')) {
                return 'ai-sdk-vendor';
              }
              return 'vendor';
            }
 
            if (
              normalizedId.endsWith('/data/structuredItemLibrary.ts') ||
              normalizedId.endsWith('/data/presetItemImages.ts')
            ) {
              return 'item-library';
            }

            // prompts/* 内部存在 core<->runtime 循环依赖（如 prompts/stats <-> prompts/runtime/fandom），
            // 拆成多个 chunk 会形成跨 chunk 循环并触发运行时 TDZ（Cannot access 'x' before initialization）。
            // 统一归入单个 prompts chunk，把循环限制在 chunk 内部，避免线上初始化崩溃。
            if (normalizedId.includes('/prompts/')) {
              return 'prompts';
            }

            if (
              normalizedId.endsWith('/utils/openingConfig.ts') ||
              normalizedId.endsWith('/utils/topicModeProfiles.ts') ||
              normalizedId.endsWith('/utils/modeRuntimeProfile.ts') ||
              normalizedId.endsWith('/utils/promptFeatureToggles.ts')
            ) {
              return 'prompts';
            }

            if (
              normalizedId.includes('/hooks/useGame/') ||
              normalizedId.endsWith('/hooks/useGame.ts') ||
              normalizedId.includes('/services/ai/')
            ) {
              return 'game-runtime';
            }
          }
}
      }
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    test: {
      exclude: [
        'node_modules/**',
        'dist/**',
        '.worktrees/**',
        '.tmp*/**',
        'test-results/**',
        'tests/e2e-*.spec.mjs',
        'tests/bugfix-*.spec.mjs',
        'tests/battle-*.spec.mjs',
        'tests/dialogue-*.spec.mjs',
        'tests/save-*.spec.mjs'
      ]
    }
  };
});
