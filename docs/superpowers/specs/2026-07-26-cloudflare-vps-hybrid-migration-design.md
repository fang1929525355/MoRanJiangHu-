# Cloudflare 与 VPS 混合迁移设计

## 1. 背景与目标

墨色江湖当前由 Cloudflare 静态资源、Worker API、D1、KV 和 Durable Object 共同提供线上服务。新 VPS 为 Debian 13、2 核 4 GB、59 GB 系统盘，仅有公网 IPv6。VPS 已运行 Nginx 静态站、HTTPS 和 APK 下载，并导入了一份约 45 MB 的 D1 SQLite 数据，但现有临时 Python API 只覆盖少量接口，不能替代正式 Worker。

本次迁移采用 Cloudflare 与 VPS 混合架构：Cloudflare 继续作为两个正式域名的公网入口、边缘网关和故障回退层；VPS 逐步成为静态网站、APK 和业务 API 的主要运行节点。

硬性目标如下：

- 现有账号、存档、创意工坊及社区数据零丢失。
- 迁移期间用户侧不中断。
- 已向用户返回成功的写入不得在任何故障中丢失，即目标 RPO 为 0。
- Worker 继续可用，并承担鉴权、路由、限流、迁移控制和故障回退。
- 每个接口可以独立切换和回滚，不执行一次性整体迁移。
- 正式发布遵守项目版本、主分支、备份提交、双域名验证和 CI 规则。

本设计不通过制造虚假负载提高 VPS 占用，也不使用未经实际指标支持的用户量、费用或资源压力描述。资源使用应来自真实业务、同步、备份和运行组件。

## 2. 已确认的现状

### 2.1 Cloudflare

当前 Worker 配置包含：

- 两个正式路由：`msjh.bacon159.pp.ua/*` 与 `msjh.bacon.de5.net/*`。
- 静态资源绑定 `ASSETS`，目录为 `dist/`。
- D1 数据库 `moranjianghu-db`。
- KV 绑定 `RELEASE_MANIFEST`。
- Durable Object `ONLINE_SESSIONS_DO`。
- 三十余个 API 文件，覆盖账号、存档、创意工坊、APK、诊断、图片、OAuth、代理和在线状态等能力。

### 2.2 VPS

VPS 当前运行：

- `moranjianghu-web`：Nginx 静态网站、TLS 与 APK 文件服务。
- `moranjianghu-migration-api`：临时 Python API 与 SQLite 数据读取。
- 项目目录当前提交为 `d8d65e6`。
- 本地 D1 导出约 45.35 MB，SQLite 数据库约 44.91 MB。

VPS 验证域名 `moranjianghu.bacon159.pp.ua` 的 APK 下载已通过实际检查：

- 版本 `1.0.628`，文件大小 `49,971,141` 字节。
- 支持 HTTP Range，请求返回 `206 Partial Content`。
- Content-Type 为 `application/vnd.android.package-archive`。
- 文件头为 `504b0304`，不是 SPA 首页。
- SHA-256 为 `b6d560bb7ccf413a784df3a13200a900a4dc44b73ea172a2a63bdf4fb4c51b3d`。

临时 API 尚不具备完整兼容性：`/api/cloud-play` 返回 JSON 404，部分未接管的 `/api/*` 被 Nginx 错误回退为 HTML 首页。正式切流前必须替换该实现，并禁止 API 路径落入 SPA 回退。

## 3. 总体架构

正式域名保持不变：

```text
用户
  -> Cloudflare DNS / TLS / Worker
       -> Cloudflare 旧 API + D1/KV/DO（迁移期与回退）
       -> VPS 源站 API + PostgreSQL + Valkey（目标主服务）
       -> VPS 静态资源与 APK
       -> Cloudflare ASSETS / OneDrive / GitHub Release（回退）
```

VPS 使用独立源站域名，例如 `origin-msjh.bacon159.pp.ua`。该域名不作为用户入口，也不匹配正式 Worker 路由。Worker 调用 VPS API 时携带内部 HMAC 签名；VPS 拒绝未签名、过期、重复或签名错误的内部请求。

当前 `moranjianghu.bacon159.pp.ua` 仅作为迁移验证入口。正式完成前，它不能替代两个现有官网域名。

### 3.1 请求分类

- 静态网站：优先从 VPS 返回，VPS 不可用时返回 Cloudflare 中最后一次成功发布的静态资源。
- APK 和大文件：优先使用 VPS 本地文件，通过 Cloudflare 转发或缓存；失败时回退 OneDrive 或 GitHub Release。
- API：每个接口独立处于 `D1_PRIMARY`、`SHADOW`、`VPS_PRIMARY` 或 `D1_FALLBACK` 状态。

迁移状态必须由受保护的配置控制，并保留审计记录。不得使用未版本化的服务器临时文件作为唯一开关来源。

## 4. 数据零丢失设计

### 4.1 正式数据组件

VPS 正式数据库使用 PostgreSQL。当前临时 SQLite 只用于导入验证，不作为生产主库。Valkey 用于在线状态、短期缓存、限流和 HMAC nonce 防重放。

OneDrive/OpenList 继续保存大型存档包、APK 和社区附件。PostgreSQL 保存账号、索引、元数据、分块记录、引用和迁移状态。VPS 系统盘不得成为大型用户数据的唯一副本。

### 4.2 D1 事务性迁移事件

在切换任何写入接口前，先在 D1 增加迁移事件表。业务写入与迁移事件必须在同一 D1 事务或原子批处理中提交。事件至少包含：

- 全局唯一 `event_id`。
- 单调排序所需的序号或可稳定排序字段。
- 数据域、业务主键和操作类型。
- 规范化后的载荷或可重建载荷。
- 载荷 SHA-256。
- 创建时间、发送次数、VPS 确认状态和最后错误。

VPS 在 PostgreSQL 中用 `event_id` 唯一约束保证幂等。重复发送只能重复确认，不能重复产生业务副作用。

### 4.3 历史快照与增量追平

顺序必须为：

1. 部署 D1 迁移事件记录能力。
2. 确认所有受影响写入路径均产生事件。
3. 导出 D1 历史数据并导入 PostgreSQL。
4. 从快照覆盖区间开始重放迁移事件；重复事件通过幂等约束消除。
5. 持续追平到待处理事件为零。
6. 执行全量一致性校验。
7. 进入影子读取和分接口切流。

导出期间不停止用户写入。删除必须作为一等事件同步，不能仅同步当前仍存在的记录。

### 4.4 切流期间的写入语义

在 `D1_PRIMARY` 和 `SHADOW` 阶段，D1 是唯一写入权威，VPS 只消费事件。影子流量不得重复执行真实用户写入。

在 `VPS_PRIMARY` 观察期，Worker 仍需先保存可恢复的写入意图，再同步调用 VPS。只有持久化意图与 VPS 提交均成功，才能向用户返回成功。若 VPS 在提交前不可用，Worker 仅在能够保证请求未在 VPS 生效时才可执行 D1 旧实现；无法证明时必须返回可重试错误，不得冒险双写。

每个写请求需要幂等键。客户端重试、Worker 重试和同步器重试必须得到同一业务结果。

### 4.5 一致性验证

切流门槛不只比较行数，还必须验证：

- 全量业务主键集合。
- 删除与墓碑状态。
- 存档分块数量、顺序和内容摘要。
- 每条规范化记录的 SHA-256。
- 用户名规范化值、密码派生参数和 GitHub 绑定关系。
- 创意工坊元数据与附件引用。
- OneDrive/OpenList 对象是否存在且可读取。
- 待同步数量、最老事件年龄和失败事件数量。

任何不一致均阻止相关数据域进入 `VPS_PRIMARY`。

## 5. API 兼容层

正式 VPS API 使用 Node.js 与 TypeScript，与 Worker 共享运行时无关的业务核心，避免继续扩展临时 Python 副本。代码边界为：

- 通用业务逻辑：参数校验、账号、存档、创意工坊、APK 路由等。
- Cloudflare 适配层：D1、KV、Durable Object 与 Worker 请求对象。
- VPS 适配层：PostgreSQL、Valkey 与 Node HTTP 服务。
- 外部存储适配层：OneDrive/OpenList、GitHub Release 与图片服务。

VPS 必须与 Worker 保持相同的：

- HTTP 状态码和 JSON 字段。
- CORS、缓存与内容类型。
- APK Range、文件名与下载响应头。
- OAuth 回调和重定向行为。
- 错误代码、超时与请求大小限制。
- 存档分块和二进制响应。

未知 `/api/*` 必须返回结构化 JSON 404，不得返回 `index.html`。

### 5.1 内部请求签名

Worker 到 VPS 的签名至少覆盖：

- HTTP 方法。
- 原始路径与查询串。
- Unix 时间戳。
- 请求正文 SHA-256。
- 随机 nonce。

VPS 只接受短时间窗内的请求，并在 Valkey 中记录 nonce 防止重放。签名密钥只存在于 Cloudflare Secret 和 VPS 权限受限的运行时环境中。

### 5.2 接口迁移顺序

1. 健康检查和迁移状态。
2. 静态网站、APK 清单和 APK 文件。
3. 无状态图片、GitHub、OpenList 和 WebDAV 代理。
4. 创意工坊和预设内容的公开只读接口。
5. 诊断报告等低风险写入。
6. GitHub OAuth 和用户身份接口。
7. 创意工坊发布、修改和附件上传。
8. 账号密码登录、云存档和跨设备同步。
9. 在线状态及原 Durable Object 能力。

每个接口依次经过 `Worker 旧实现 -> 影子对比 -> VPS 主用 -> Worker 回退保留`。不得跳过契约测试和观察期。

## 6. VPS 基础设施

使用固定版本 Docker 镜像和 Docker Compose 管理：

- `gateway`：Nginx，处理 TLS、静态资源、APK 和边界限制。
- `api`：Node.js/TypeScript 正式 API。
- `postgres`：PostgreSQL 主数据库。
- `valkey`：在线状态、缓存、限流和防重放。
- `replicator`：增量复制、重试和一致性核对。
- `backup`：加密备份、保留和 OneDrive 上传。

只有 80、443 和受保护的 SSH 对公网开放。PostgreSQL、Valkey 和内部 API 不开放公网端口。

### 6.1 初始资源预算

- PostgreSQL：1 至 1.25 GB。
- API：768 MB 至 1 GB。
- Valkey：最高 256 MB。
- 同步器与备份任务：各约 256 MB。
- Nginx：约 128 MB。
- Debian、Docker 和突发任务：至少预留约 1 GB。

磁盘必须限制容器日志、镜像层、本地缓存和备份保留量，长期至少保留 20 GB 空闲空间。

### 6.2 运行保障

- 所有长期运行容器配置健康检查和自动重启。
- 健康状态分别反映进程、PostgreSQL、Valkey、OneDrive 和复制延迟。
- 日志使用结构化格式，并限制单文件大小和保留周期。
- 监控待同步事件数、最老事件年龄、失败次数和摘要差异。
- 连续失败时暂停对应接口切换，不自动丢弃事件。
- 数据库至少每日完整备份，并保存持续增量事件。
- 定期在隔离数据库执行真实恢复测试。

建立专用部署用户。确认新用户、密钥和回滚入口正常后，才考虑关闭 root 远程登录。真实密钥不得写入仓库、镜像、普通日志或聊天内容。

## 7. 实施阶段

### 阶段 1：现状封存

备份 Cloudflare 配置、D1、KV、VPS 配置和 APK，记录线上接口基准。开始实施前必须协调并停止其他会话对 VPS 临时迁移服务的并行修改。

### 阶段 2：VPS 基础设施

建立 PostgreSQL、Valkey、正式 API、同步器、备份与内部源站。仅通过迁移验证入口检查，不接入正式域名。

### 阶段 3：数据复制

启用 D1 迁移事件日志，导入历史数据，重放增量事件，并完成全量一致性校验。

### 阶段 4：接口兼容验证

对安全读取请求进行影子比较。写入接口使用自动化契约测试与隔离测试账号，不影子执行真实用户写入。

### 阶段 5：分级切流

按既定顺序逐项切换，先小比例请求，再扩大流量。每一步均设置观察时间和自动回退条件。

### 阶段 6：正式发布

在公开发布前将完整预期变更集成到 `main`，更新版本和真实 `releasePublishedAt`，同步发布元数据，再构建、上传、部署和验证。创建并推送发布备份提交，检查 `ypq123456789/MoRanJiangHu` 对应提交的最新 CI。

内部源站上的非公开预演不视为正式发布。任何影响正式域名的部署均遵守项目版本递增规则。

## 8. 验收标准

正式迁移完成必须同时满足：

- D1 与 PostgreSQL 的业务记录、删除状态和摘要全部一致。
- 待同步事件为零，新增事件能在目标时间内追平。
- 注册、密码登录、GitHub OAuth、上传、下载、存档和跨设备同步通过。
- 创意工坊发布、列表、详情和附件下载通过。
- Worker、VPS API、PostgreSQL 或 Valkey 单组件故障不会产生虚假成功写入。
- 两个正式域名显示相同版本和准确发布时间。
- 两个域名的 `release-info.json` 和前端 bundle 哈希与本地构建一致。
- APK 清单、下载、大小、SHA-256 和签名全部正确。
- PostgreSQL 备份可在隔离环境恢复。
- 压力测试后 CPU、内存、连接数、磁盘和响应时间均有安全余量。
- 发布备份提交已推送到 `main`，对应 CI 成功。

目标 RPO 为 0。普通 VPS API 故障应在约 30 至 60 秒内由 Worker 回退。无法安全完成的写入必须明确提示重试，不能返回虚假成功。

## 9. 回滚策略

回滚以数据域或单接口为单位修改 Worker 路由状态，使其恢复到 D1 旧实现。回滚不删除 VPS 数据，不逆向覆盖 D1，也不清空迁移事件。故障修复后，从最后确认的事件编号继续同步。

执行回滚前后均记录：

- 路由状态与修改时间。
- D1 和 VPS 的最后确认事件编号。
- 未决与失败事件数量。
- 触发原因及受影响接口。
- 回滚后的契约测试和数据核对结果。

## 10. 客户可见变更口径

在实际完成公开迁移前不发布“迁移完成”的客户公告。正式发布后，客户说明应聚焦于官网、APK 下载、账号和云存档服务稳定性提升，不公开管理接口、监控面板或内部运维细节，并包含主站地址 `https://msjh.bacon159.pp.ua/`。
