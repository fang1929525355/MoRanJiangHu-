# 夸克 TV APK 主渠道与下载统计设计

## 背景

当前 APK 下载入口由 Cloudflare Worker 返回渠道跳转，默认使用 OneDrive，并保留 GitHub Release、GitHub Raw 等备用来源。现有 Worker 没有持久化 APK 下载统计，因此只能从 GitHub Release 的 `download_count` 获得部分历史下限，无法统计 OneDrive、GitHub Raw 和网站默认入口的完整下载量。

国内无代理环境的实测结果显示：

- `115open` 平均约 13.62 MiB/s，但用户不接受公开分发带来的 115 账号风险。
- `夸克TV` 平均约 3.37 MiB/s，支持 302 跳转、`206 Partial Content` 和断点续传。
- 普通 `夸克` 与 `夸克网盘open` 当前由 OpenList 代理文件字节，速度不足 0.12 MiB/s，不适合作为公开下载入口。

因此，APK 写入使用普通 `夸克` 挂载，公开下载使用同一账号内容对应的 `夸克TV` 挂载。Worker 只负责签名、统计和 302 跳转，不代理 APK 文件内容。

## 目标

1. 将 `夸克TV` 设为 APK 默认下载渠道。
2. 保留 OneDrive、GitHub Release 和 GitHub Raw 自动回退。
3. 发布时同步上传版本 APK 和 `latest.apk` 到夸克账号。
4. 在 D1 中记录按日期、版本和渠道聚合的下载请求数。
5. 不保存 IP、User-Agent、Cookie 或其他可识别用户的信息。
6. 不让 Worker 中转 APK 字节，不以技术手段隐藏网盘的实际下载行为。

## 非目标

- 不使用 115 作为公开 APK 分发渠道。
- 不修复或依赖 `夸克网盘open` 的代理下载性能。
- 不统计 CDN 是否完整传输了每个 APK；统计口径是 Worker 接收到的有效下载请求。
- 不在本次本地实现阶段部署网站或发布新版本。
- 不修改游戏内容、APK 包内容或 Android 签名。

## 渠道顺序

默认渠道顺序如下：

1. `quark-tv`
2. `onedrive`
3. `github`
4. `github-raw`

显式的 `provider` 查询参数继续允许选择受支持的备用渠道，便于测速、诊断和人工兜底。退役的 R2、B2 和 hi168 渠道不重新启用。

## 存储布局

上传路径使用可写的普通夸克挂载：

```text
/夸克/MoRanJiangHu/releases/latest.apk
/夸克/MoRanJiangHu/releases/MoRanJiangHu-v<version>.apk
```

下载路径使用对应的夸克 TV 挂载：

```text
/夸克TV/MoRanJiangHu/releases/latest.apk
/夸克TV/MoRanJiangHu/releases/MoRanJiangHu-v<version>.apk
```

两个挂载指向同一个夸克账号。发布脚本只向普通 `夸克` 挂载写入文件；Worker 只从 `夸克TV` 挂载读取文件信息和签名。

## 下载请求流程

1. 客户端请求网站同源 APK 地址，例如 `/api/apk/latest.apk`。
2. Worker 读取发布清单，确定版本和默认渠道。
3. Worker 调用 OpenList API 查询 `夸克TV` 下的目标 APK。
4. Worker 获取目标文件的签名并构造 OpenList `/d/夸克TV/...` 地址。
5. Worker 异步写入 D1 聚合计数。
6. Worker 返回 `302`，由 OpenList 再跳转到夸克 CDN。
7. 如果夸克文件不存在、签名获取失败、接口超时或响应异常，Worker 按渠道顺序尝试下一个来源。

Worker 不读取 APK 响应体，也不缓存或转发 APK 字节。

## 下载统计

新增 D1 表：

```sql
CREATE TABLE IF NOT EXISTS apk_download_daily (
  day TEXT NOT NULL,
  version_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (day, version_name, provider)
);
```

统计规则：

- 只统计 Worker 实际准备返回下载响应的 `GET` 请求。
- `HEAD`、清单请求、健康检查和签名查询不计数。
- 每次下载尝试计一次，不按 IP 去重。
- 每个最终选中的渠道单独计数；回退前失败的渠道不计入成功下载数。
- D1 写入失败不能阻断下载，使用 `waitUntil` 异步执行并吞掉统计错误。
- 不保存 IP、国家、城市、User-Agent、Referer 或 Cloudflare 请求标识。

该口径表示“下载入口成功跳转次数”，不是安装量或完整下载完成量。

## 发布流程

发布脚本在现有 OneDrive 和 GitHub 发布流程之外增加夸克同步：

1. 校验本地 APK 路径、大小和 SHA-256。
2. 上传版本 APK 到普通 `夸克` 挂载。
3. 上传或覆盖 `latest.apk`。
4. 通过 `夸克TV` 挂载查询两个文件，确认大小一致。
5. 获取签名下载地址并执行限定范围下载，确认 `206`、`Content-Range` 和 APK 文件头。
6. 仅在夸克验证成功后，将发布清单首选渠道写为 `quark-tv`。

夸克上传失败时，发布脚本必须返回失败，不得生成声称夸克为首选但实际缺少文件的清单。

## 错误处理与回退

- OpenList API 缺少令牌：跳过夸克并回退 OneDrive。
- `夸克TV` 文件不存在或没有签名：回退 OneDrive。
- OpenList API 超时或返回非 200：回退 OneDrive。
- OneDrive 失败：回退 GitHub Release。
- GitHub Release 无有效版本：回退 GitHub Raw。
- 所有渠道失败：返回明确的 `503`，不返回损坏或空的 APK 响应。

渠道响应使用 `X-Moran-Apk-Source` 标识最终来源，便于浏览器和自动化测试确认实际选择。

## 安全与运营约束

- OpenList 管理令牌继续只存在于本地环境和 Cloudflare Secret。
- 下载 URL 只暴露短期签名，不暴露 OpenList 管理令牌。
- Worker 不作为掩盖用户来源的文件代理。
- 不记录个人标识，不建立跨日用户画像。
- 保留 OneDrive 和 GitHub 回退，避免夸克账号、接口或 CDN 临时异常导致下载中断。
- 通过每日聚合数据观察下载量；若公开分发出现账号警告、限速或异常流量，立即将首选渠道切回 OneDrive。

## 测试设计

### 单元测试

- 默认请求选择 `quark-tv`。
- 显式 `provider` 可以选择各备用渠道。
- 夸克签名成功时返回正确的 302、文件名和来源响应头。
- 夸克签名失败时按顺序回退 OneDrive、GitHub Release 和 GitHub Raw。
- `GET` 成功跳转触发一次 D1 聚合写入。
- `HEAD` 和失败渠道不增加统计。
- D1 写入失败不影响下载响应。
- 清单中的 URL 顺序与默认渠道顺序一致。

### 发布脚本测试

- 上传目标路径分别为版本文件和 `latest.apk`。
- 上传后从 `夸克TV` 路径校验文件大小。
- 夸克校验失败时脚本以非零状态退出。
- 发布清单包含 `quarkTvApkUrl`，并将 `preferredApkProvider` 设为 `quark-tv`。

### 本地集成验证

- 运行 APK 路由相关 Vitest 测试。
- 运行完整 `npm run test:run`。
- 运行 `npm run build`。
- 使用模拟 OpenList 响应确认下载路由不读取 APK 字节。
- 未经用户明确要求，不执行线上部署或真实发布。

## 上线后验证

用户明确要求部署后，按项目发布规则升级版本并完成发布。上线验证包括：

- 主、备域名的版本号和发布时间一致。
- `/release-info.json` 与本地构建一致。
- 静态资源哈希与本地 `dist` 一致。
- `/api/apk/latest.json` 首选渠道为 `quark-tv`。
- `/api/apk/latest.apk` 返回夸克来源响应头并最终跳转夸克 CDN。
- 限定范围下载返回 `206` 和正确 `Content-Range`。
- D1 当日 `quark-tv` 计数增加一次。
- OneDrive 和 GitHub 显式渠道仍可用。

## 回滚

回滚不删除夸克文件，只将默认提供者改回 `onedrive` 并重新生成发布清单。D1 历史统计保留，便于比较切换前后的渠道使用量。回滚同样需要按项目部署规则执行版本和线上验证。
