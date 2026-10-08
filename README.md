# Pastebin-ui

这是一个基于 Cloudflare Workers 和 KV 的轻量级内容中转站项目，适合需要简洁、高效解决内容存储需求的开发者使用。无需依赖 R2 存储桶，部署方便，适用于小型项目。

该项目是原项目的历史版本，由于我个人认为还有需要，所以单独提取出来了，供大家使用，本人不拥有该项目，开源协议集成原项目，如有侵犯请联系删除。

原项目仓库：[Pastebin Worker - 历史版本](https://github.com/xiadd/pastebin-worker)

## 目录结构

```
src/                 Worker 后端（Hono）
static/              前端（React + Vite + TS）
scripts/             工具脚本
wrangler.toml.example  部署配置模板（真正的 wrangler.toml 不入库）
```

## 部署文档

### 1. 手动部署(推荐)

#### 获取 Cloudflare API Token

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
2. 点击右上角的个人头像，选择 **My Profile**。
3. 进入 **API Tokens** 页面。
4. 点击 `Create Token`，选择 `Edit Cloudflare Workers` 模板。
5. 配置并创建后，复制生成的 API Token。

> 权限最小化建议：自定义 Token，只勾选
> `Account > Workers Scripts > Edit`、`Account > Workers KV Storage > Edit`、
> `Zone > Workers Routes > Edit`（使用自定义域名时需要）以及只读的
> `User > User Details`、`Account > Account Settings`。不要使用 Global API Key。

![获取 API Token](./docs/get_api.png)

#### 创建 KV 存储

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
2. 点击左侧列表中的存储和数据库，选择 `KV`。
3. 创建两个 `KV`，名称分别为：`PB`（存文本）、`PBIMGS`（存文件）。
4. 保存好 namespace `ID`，后面要用。

![创建KV](/docs/create_kv.png)

#### 在 GitHub 中配置 Secret 与 Variable

打开项目的 GitHub 仓库，进入 **Settings > Secrets and variables > Actions**。
**在仓库里不放任何真实 ID**，全部通过下面这些项注入，CI 会在构建时生成
`wrangler.toml`（模板见 `wrangler.toml.example`）：

| 类型 | 名称 | 必填 | 说明 |
| --- | --- | --- | --- |
| Secret | `CF_API_TOKEN` | ✅ | 上一步生成的 API Token |
| Secret | `CF_ACCOUNT_ID` | ✅ | Cloudflare Account ID |
| Secret | `PB_KV_ID` | ✅ | 文本 KV（`PB`）的 namespace id |
| Secret | `PBIMGS_KV_ID` | ✅ | 文件 KV（`PBIMGS`）的 namespace id |
| Secret | `ADMIN_TOKEN` | ⬜ | 管理后台口令。**不配置则后台整体禁用**（`/api/admin/*` 返回 503） |
| Variable | `BASE_URL` | ✅ | 站点地址，如 `https://note.example.com` |
| Variable | `ALLOWED_ORIGINS` | ⬜ | 允许跨域调用 API 的来源，逗号分隔；默认取 `BASE_URL` |

![设置 GitHub Secret](./docs/set_secret.png)

#### 修改前端环境变量

在 `./static/.env` 中设置前端要调用的 Worker 地址：

```env
VITE_API_URL=<你的 Cloudflare Worker 部署地址>
```

> 生产构建会读取 `static/.env.production`。其中 `VITE_API_URL` 默认为空，
> 表示前后端同源部署，直接请求 `/api/*` 即可，不必写死域名。

![设置环境变量](./docs/set_env.png)

#### 部署到 Cloudflare

- 每次将代码 push 到 `main` 分支后，GitHub Actions 会自动触发部署任务。
- 若需要手动运行部署任务：
  1. 打开 GitHub Actions 页面。
  2. 找到对应的 Action，点击 `Run workflow`。

![运行部署 Action](./docs/run_action.png)

### 2. 本地开发部署(DEV)

#### 配置 Cloudflare Workers KV Namespace

1. 登录 Cloudflare Dashboard，创建两个 KV Namespace：
   - 一个用于存储文件（命名为 `PBIMGS`）。
   - 一个用于存储文字（命名为 `PB`）。
2. 记录它们的 `ID`。

#### 生成 `wrangler.toml`

复制模板后按注释填写即可：

```bash
cp wrangler.toml.example wrangler.toml
```

或者用脚本从环境变量生成：

```bash
CF_ACCOUNT_ID=<account_id> \
PB_KV_ID=<PB kv id> \
PBIMGS_KV_ID=<PBIMGS kv id> \
BASE_URL=https://note.example.com \
node scripts/gen-wrangler.mjs
```

`wrangler.toml` 已被 `.gitignore` 忽略，请勿提交。如果你之前已经提交过它，
需要执行一次 `git rm --cached wrangler.toml` 让它脱离版本跟踪。

#### 配置本地变量（可选）

```bash
cp .dev.vars.example .dev.vars
```

### 启动服务

#### 后端启动

```bash
yarn install
wrangler dev
```

#### 前端启动

```bash
cd static
yarn install
yarn dev
```

启动完成后：
- 后端地址为 `http://localhost:8787`。
- 前端地址为 `http://localhost:5173`。

> 本地跨端口调试时，`ALLOWED_ORIGINS` 里要包含 `http://localhost:5173`，
> 否则 `/api/*` 不会下发 CORS 头。

#### 测试前端打包效果

在 `static` 目录下运行：

```bash
yarn build
```

访问 `http://localhost:8787` 查看打包后的前端页面效果。

## 开发文档

### 环境初始化

1. 安装 Wrangler CLI：

   ```bash
   npm i -g wrangler
   ```

2. 登录 Cloudflare 账号：

   ```bash
   wrangler login
   ```

3. 验证登录：

   ```bash
   wrangler whoami
   ```

   显示用户名即表示登录成功。

### 安装依赖

```bash
yarn install
cd static && yarn install
```

### 配置文件

参考 [部署文档](#生成-wrangler-toml) 中的 `wrangler.toml` 与 `.dev.vars` 设置。

### 测试

- 在本地访问 `http://localhost:5173` 测试前端。
- 测试后端接口地址为 `http://localhost:8787`。

### 部署到 Cloudflare

详见 [部署文档](#部署文档)。

## 管理后台

站点自带一个后台，用来**查看、复制和删除**所有人上传的内容，并按上传时间排序，
主要用于及时发现并下架违法或垃圾内容。

- 入口：`https://<你的域名>/admin`
- 鉴权：登录时填 `ADMIN_TOKEN`，前端通过 `x-admin-token` 请求头带给后端；
  口令只存在浏览器 `sessionStorage`，关掉标签页即失效。

### 配置口令

`ADMIN_TOKEN` 是一串口令、属于机密，**刻意不放进 `wrangler.toml`**。三种方式任选：

1. **GitHub Actions（推荐）**：在仓库 Secrets 里新增 `ADMIN_TOKEN`。
   `deploy.yml` 已经把它交给 wrangler-action，以加密 secret 的形式写入 Worker。
2. **手动设置**：
   ```bash
   wrangler secret put ADMIN_TOKEN
   ```
3. **本地开发**：写进 `.dev.vars`（已被 `.gitignore` 忽略）：
   ```
   ADMIN_TOKEN=dev-token
   ```

> 未配置时 `/api/admin/*` 一律返回 `503`，后台处于禁用状态。
> 这是刻意设计，避免出现一个没有口令的管理入口。

### 后台能做什么

| 功能 | 说明 |
| --- | --- |
| 按时间浏览 | 默认按上传时间**倒序**（最新在前），可切换正序 |
| 类型筛选 | 全部 / 文本 / 文件 |
| 关键词搜索 | 匹配 ID、文件名、内容摘要、来源 IP |
| 全文排查 | 回读正文逐条匹配关键词（较慢，有扫描上限），用于定位正文里的敏感词 |
| 内容预览 | 点「查看」即可看到完整正文、文件信息和来源 IP / UA |
| 复制 | 一键复制分享链接或正文，便于取证留存 |
| 删除 | 单条删除，或勾选后批量删除；删除后链接立即失效 |
| 来源追溯 | 每条记录带上传者 IP 与 User-Agent（可用 `LOG_CLIENT_INFO=0` 关闭） |

### 关于「按上传时间排序」

Cloudflare KV 的 `list()` 只按 key 的字典序返回，**既不返回创建时间也不认识业务时间**。
因此这里的排序是这样实现的：

- 上传时把 `create_time`（毫秒时间戳）写进 KV 的 metadata；
- 列表时利用 `list()` 默认就会带回的 metadata，在内存里排序。

有一点必须说清楚：**这套代码上线之前上传的老数据没有 `create_time`**，
后台只能把它们标成「时间未知」并固定排在列表最后 —— 但查看、复制、删除都照常可用。

### 上传者信息与隐私

默认会把上传者 IP 和 User-Agent 记进 metadata，这是事后追责的唯一线索。
如果不需要，把环境变量 `LOG_CLIENT_INFO` 设为 `0` 即可关闭（关闭后来源列会是空的）。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/create` | 创建文本粘贴。body: `content` / `expire`(秒，≥60) / `isPrivate` / `language` / `share_password`。私有粘贴的明文密码**只在本次响应返回一次** |
| `GET` | `/api/get?id=&share_password=` | 获取粘贴内容和元信息（不回传密码） |
| `POST` | `/api/upload` | 上传文件（表单字段 `file`，上限 25MB） |
| `GET` | `/raw/:id?share_password=` | 以纯文本形式取回内容 |
| `GET` | `/file/:id` | 取回文件；仅图片类型内联，其余强制下载 |
| `GET` | `/api/admin/list` | 后台列表。query: `type`(all/text/file)、`keyword`、`order`(desc/asc)、`page`、`pageSize` |
| `GET` | `/api/admin/content?id=&type=` | 取单条完整内容（文本给正文，文件给元信息） |
| `GET` | `/api/admin/search?keyword=` | 回读正文做全文匹配，最多扫描 300 条 |
| `POST` | `/api/admin/delete` | 删除，body: `{ items: [{ id, type }] }`，单次上限 200 条 |

> `/api/admin/*` 全部需要请求头 `x-admin-token`。

## 安全说明

- **内容消毒**：Markdown 渲染前经 DOMPurify 处理，避免粘贴内容变成存储型 XSS。
- **文件类型**：`/file/:id` 只对图片类型使用 `inline`，其它一律 `attachment` +
  `X-Content-Type-Options: nosniff`，并附带 `Content-Security-Policy`，防止上传
  HTML/SVG 后在本域执行脚本。
- **密码**：服务端只保存 `SHA-256(salt + password)`，比较使用常量时间算法，
  接口不回传密码明文。
- **CORS**：`/api/*` 默认只允许 `ALLOWED_ORIGINS` 中列出的来源。
- **管理后台**：`/api/admin/*` 校验 `x-admin-token`，比较为常量时间，失败再额外延迟
  300ms；未配置 `ADMIN_TOKEN` 时整组接口直接 503。该组接口**不下发任何 CORS 头**，
  跨域调用会在浏览器预检阶段被拦下，因此也没有 CSRF 面。后台展示上传内容时
  一律按纯文本渲染，绝不会把别人上传的内容当 HTML 执行。
- **上传者留存**：metadata 中记录上传者 IP / User-Agent（`LOG_CLIENT_INFO=0` 可关闭），
  用于违法内容的事后追溯。
- **写入防护（建议自行开启）**：`/api/create` 与 `/api/upload` 对外完全开放，
  建议在 Cloudflare 控制台加上
  1. **Security > WAF > Rate limiting rules**：按 IP 限制 `/api/*` 的请求频率；
  2. 需要更强防护时，为上传接口接入 **Turnstile**；
  3. 给对应域名设置用量告警，避免被刷爆 KV 写入。
