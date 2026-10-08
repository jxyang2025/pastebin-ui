import { KVNamespace, KVNamespacePutOptions } from '@cloudflare/workers-types';
import { Hono } from 'hono';
import { serveStatic } from 'hono/cloudflare-workers';
import { customAlphabet } from 'nanoid';

import config from './config';

/** KV 单值上限 25MB */
const MAX_TEXT_SIZE = 1024 * 1024 * 25;
const MAX_FILE_SIZE = 1024 * 1024 * 25;

/**
 * metadata 整体上限 1024 字节（JSON 序列化后）。
 * 中文按最坏情况 6 字节/字（\uXXXX 转义）估算，
 * 下面这几个截断值是给 hash/salt/时间戳等字段留足空间后的结果，别随意调大。
 */
const PREVIEW_LENGTH = 40;
const UA_MAX_LENGTH = 50;
const IP_MAX_LENGTH = 45;

/** 管理后台列表每页上限 */
const ADMIN_PAGE_MAX = 200;
/** KV list 单次最多 1000 条，最多翻这么多页，防止极端情况下打满 CPU */
const ADMIN_SCAN_MAX_PAGES = 10;

/** KV expirationTtl 的最小值是 60 秒，小于它会直接抛错 */
const MIN_TTL = 60;
/** 文件默认保留 1 年，避免 PBIMGS 只增不减 */
const DEFAULT_FILE_TTL = 60 * 60 * 24 * 365;

const ID_SEED =
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_';
const ID_LENGTH = 6;

const nanoid = customAlphabet(ID_SEED, ID_LENGTH);

/**
 * 只有这些类型允许内联返回。
 * 其余（尤其是 text/html、image/svg+xml）强制下载 + nosniff，
 * 否则上传一个 .html/.svg 就等于在本域拿到一个存储型 XSS。
 */
const INLINE_SAFE_MIME = /^image\/(png|jpeg|jpg|gif|webp|avif|bmp|x-icon)$/i;

type Bindings = {
  PB: KVNamespace;
  PBIMGS: KVNamespace;
  ENVIRONMENT?: string;
  BASE_URL?: string;
  ALLOWED_ORIGINS?: string;
  FILE_TTL?: string;
  /** 管理后台口令；未配置时整个 /api/admin/* 直接禁用 */
  ADMIN_TOKEN?: string;
  /** 设为 '0' 则不再记录上传者 IP / UA */
  LOG_CLIENT_INFO?: string;
};

/**
 * 上传者信息。记录它是「事后追责」的唯一线索：
 * 一旦有人上传违法内容，只有 IP 才能定位到人。
 * 通过 LOG_CLIENT_INFO=0 可以关掉。
 */
type ClientInfo = {
  ip?: string;
  ua?: string;
};

type PasteMetadata = {
  language: string;
  create_time: number;
  has_password?: boolean;
  share_password_hash?: string;
  share_password_salt?: string;
  /**
   * 内容开头若干字符。存进 metadata 有两个好处：
   * 列表页无需回读 value 就能展示摘要，关键词搜索也能直接命中。
   * 注意 KV metadata 有 1024 字节上限，长度必须克制（见 PREVIEW_LENGTH）。
   */
  preview?: string;
} & ClientInfo;

type FileMetadata = {
  mimeType: string;
  name: string;
  create_time?: number;
  size?: number;
} & ClientInfo;

const app = new Hono<{ Bindings: Bindings }>();

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 站点地址：优先环境变量，其次由请求自身 origin 推导（本地 dev / 自定义域名都适用） */
function baseUrl(c: { env: Bindings; req: { url: string } }): string {
  const configured = c.env.BASE_URL || config.BASE_URL;
  const origin = configured ? configured : new URL(c.req.url).origin;
  return origin.replace(/\/+$/, '');
}

/** SHA-256(salt:password)，仅以哈希形式落库 */
async function hashPassword(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** 常量时间比较，避免按字符逐位比较带来的时序侧信道 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** 校验密码；粘贴没有设密码时直接放行 */
async function verifyPassword(
  password: string | undefined,
  metadata: PasteMetadata,
): Promise<boolean> {
  if (!metadata.share_password_hash) return true;
  if (!password) return false;
  const hash = await hashPassword(password, metadata.share_password_salt ?? '');
  return timingSafeEqual(hash, metadata.share_password_hash);
}

/**
 * 生成 id 并确认未被占用。
 * 单纯依赖 6 位随机串碰撞概率虽低，但一旦碰撞会静默覆盖别人的粘贴。
 */
async function generateId(kv: KVNamespace): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = nanoid();
    const existing = await kv.getWithMetadata(id);
    if (!existing.value) return id;
  }
  // 极端情况下加长 id 兜底
  return customAlphabet(ID_SEED, 12)();
}

/** 取出上传者信息；ADMIN 可在 wrangler 里用 LOG_CLIENT_INFO=0 关闭 */
function clientInfo(c: {
  env: Bindings;
  req: { header: (name: string) => string | undefined };
}): ClientInfo {
  if ((c.env.LOG_CLIENT_INFO ?? '1') === '0') return {};

  const ip =
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  const ua = c.req.header('user-agent');

  const info: ClientInfo = {};
  if (ip) info.ip = ip.slice(0, IP_MAX_LENGTH);
  if (ua) info.ua = ua.slice(0, UA_MAX_LENGTH);
  return info;
}

/** 截取内容开头作为 metadata 里的摘要 */
function makePreview(content: string): string {
  // 压缩掉换行和连续空白，避免摘要里全是空行看不到重点
  return content.slice(0, PREVIEW_LENGTH * 4).replace(/\s+/g, ' ').trim().slice(0, PREVIEW_LENGTH);
}

/**
 * 把某个 namespace 的 key 全部拉平。
 *
 * KV 的 list() 只按 key 的字典序返回，完全不认识「上传时间」，
 * 所以时间排序只能靠 metadata 里的 create_time 在内存里做。
 * 好消息是 list() 默认就会把每个 key 的 metadata 一起带回来，不必额外回读 value。
 * 单次最多 1000 条，需要 cursor 翻页。
 */
async function listAllKeys(kv: KVNamespace): Promise<
  Array<{ name: string; expiration?: number; metadata?: unknown }>
> {
  const out: Array<{ name: string; expiration?: number; metadata?: unknown }> = [];
  let cursor: string | undefined;

  for (let page = 0; page < ADMIN_SCAN_MAX_PAGES; page += 1) {
    const res = await kv.list({ cursor, limit: 1000 });
    for (const key of res.keys) {
      out.push({
        name: key.name,
        expiration: key.expiration,
        metadata: key.metadata,
      });
    }
    if (res.list_complete || !res.cursor) break;
    cursor = res.cursor;
  }

  return out;
}

// ---------------------------------------------------------------------------
// 中间件
// ---------------------------------------------------------------------------

app.use('/api/*', async (c, next) => {
  /*
   * 管理接口刻意不走 CORS：一个 Access-Control-* 头都不发。
   * 浏览器在预检阶段拿不到许可就会直接拦掉跨域请求，
   * 而且 /api/admin/* 强制要求自定义头 x-admin-token，
   * 自定义头本身就会触发预检，于是 CSRF 也一并挡住了。
   */
  if (c.req.path.startsWith('/api/admin/')) {
    c.header('Cache-Control', 'no-store');
    return next();
  }

  const allowed = (c.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const origin = c.req.header('Origin');
  const permissive = allowed.includes('*');

  if (origin && (permissive || allowed.includes(origin))) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type');
    c.header('Access-Control-Max-Age', '86400');
  }
  c.header('Vary', 'Origin');

  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }
  return next();
});

app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: 'Not found', code: 404 }, 404);
  }
  return c.text('Not found', { status: 404 });
});

app.onError((err, c) => {
  // 内部错误细节只进日志，不返回给客户端
  console.error('[pastebin] unhandled error:', err);
  return c.json({ error: 'Internal Server Error', code: 500 }, 500);
});

// ---------------------------------------------------------------------------
// 静态资源
// ---------------------------------------------------------------------------

app.get('/detail/*', serveStatic({ path: './index.html' }));
// 管理后台是前端路由，刷新时需要回退到同一个入口
app.get('/admin', serveStatic({ path: './index.html' }));
app.get('/admin/*', serveStatic({ path: './index.html' }));
app.get('/*', serveStatic({ root: './' }));

// ---------------------------------------------------------------------------
// 读取原文
// ---------------------------------------------------------------------------

app.get('/raw/:id', async (c) => {
  const id = c.req.param('id');
  const password = c.req.query('share_password');

  const res = await c.env.PB.getWithMetadata<PasteMetadata>(id);
  if (!res.value) {
    return c.text('Not found', { status: 404 });
  }

  const metadata = (res.metadata ?? {}) as PasteMetadata;
  // 注意：密码校验必须整体放在「有密码」这个前提下，
  // 否则公开粘贴只要带上 share_password 参数就会被误判为密码错误。
  if (metadata.share_password_hash) {
    if (!password) {
      return c.text('Private paste, please provide password', { status: 403 });
    }
    if (!(await verifyPassword(password, metadata))) {
      return c.text('Wrong password', { status: 403 });
    }
  }

  return c.text(res.value, {
    // 可能是私有内容，禁止任何中间层缓存
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
});

// ---------------------------------------------------------------------------
// 创建粘贴
// ---------------------------------------------------------------------------

app.post('/api/create', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON body', code: 400 }, 400);
  }

  const { content, expire, isPrivate, language, share_password } = body ?? {};

  if (typeof content !== 'string' || !content) {
    return c.json({ error: 'Content is required', code: 400 }, 400);
  }
  if (content.length > MAX_TEXT_SIZE) {
    return c.json({ error: 'Content is too large', code: 413 }, 413);
  }

  let ttl = 0;
  if (expire !== undefined && expire !== null && expire !== '' && expire !== 0) {
    ttl = Number(expire);
    if (!Number.isInteger(ttl) || ttl < MIN_TTL) {
      return c.json(
        { error: `Expiration must be an integer >= ${MIN_TTL} seconds`, code: 400 },
        400,
      );
    }
  }

  const id = await generateId(c.env.PB);
  const createTime = Date.now();
  const metadata: PasteMetadata = {
    language: typeof language === 'string' && language ? language : 'text',
    create_time: createTime,
    preview: makePreview(content),
    ...clientInfo(c),
  };

  // 明文密码只在此处回给创建者一次，KV 里只存哈希
  let plainPassword: string | undefined;
  if (isPrivate) {
    plainPassword =
      (typeof share_password === 'string' && share_password.trim()) ||
      customAlphabet(ID_SEED, 10)();
    const salt = crypto.randomUUID().replace(/-/g, '');
    metadata.has_password = true;
    metadata.share_password_salt = salt;
    metadata.share_password_hash = await hashPassword(plainPassword, salt);
  }

  const putOptions: KVNamespacePutOptions = { metadata };
  if (ttl) putOptions.expirationTtl = ttl;

  await c.env.PB.put(id, content, putOptions);

  return c.json({
    id,
    url: `${baseUrl(c)}/detail/${id}`,
    language: metadata.language,
    expire: ttl,
    create_time: createTime,
    has_password: Boolean(metadata.has_password),
    share_password: plainPassword,
  });
});

// ---------------------------------------------------------------------------
// 获取粘贴
// ---------------------------------------------------------------------------

app.get('/api/get', async (c) => {
  const id = c.req.query('id');
  const password = c.req.query('share_password');

  if (!id) {
    return c.json({ error: 'id is required', code: 400 }, 400);
  }

  const res = await c.env.PB.getWithMetadata<PasteMetadata>(id);
  // getWithMetadata 永远返回对象，key 不存在时 metadata 为 null，
  // 因此这里必须判断 value，否则会抛 TypeError 变成 500。
  if (!res.value) {
    return c.json({ error: 'Not found', code: 404 }, 404);
  }

  const metadata = (res.metadata ?? {}) as PasteMetadata;

  if (metadata.share_password_hash) {
    if (!password) {
      return c.json(
        { error: 'Private paste, please provide password', code: 403 },
        403,
      );
    }
    if (!(await verifyPassword(password, metadata))) {
      return c.json({ error: 'Wrong password', code: 403 }, 403);
    }
  }

  // 不回传密码（哪怕是哈希），前端自己手上的明文足够拼链接
  return c.json({
    content: res.value,
    url: `${baseUrl(c)}/detail/${id}`,
    language: metadata.language ?? 'text',
    create_time: metadata.create_time,
    has_password: Boolean(metadata.has_password),
  });
});

// ---------------------------------------------------------------------------
// 文件上传 / 下载
// ---------------------------------------------------------------------------

app.post('/api/upload', async (c) => {
  const body = await c.req.parseBody();
  const file = body['file'];

  if (!(file instanceof File)) {
    return c.json({ error: 'File is required', code: 400 }, 400);
  }
  if (file.size > MAX_FILE_SIZE) {
    return c.json({ error: 'File is too large', code: 413 }, 413);
  }

  const id = await generateId(c.env.PBIMGS);
  const ttl = Number(c.env.FILE_TTL) > MIN_TTL ? Number(c.env.FILE_TTL) : DEFAULT_FILE_TTL;
  const metadata: FileMetadata = {
    mimeType: file.type || 'application/octet-stream',
    name: file.name || 'file',
    create_time: Date.now(),
    size: file.size,
    ...clientInfo(c),
  };

  await c.env.PBIMGS.put(id, await file.arrayBuffer(), {
    expirationTtl: ttl,
    metadata,
  });

  return c.json({ id, url: `${baseUrl(c)}/file/${id}` });
});

app.get('/file/:id', async (c) => {
  const id = c.req.param('id');
  const res = await c.env.PBIMGS.getWithMetadata<FileMetadata>(id, 'arrayBuffer');

  if (!res.value) {
    return c.text('Not found', { status: 404 });
  }

  const metadata = (res.metadata ?? {}) as Partial<FileMetadata>;
  const contentType = metadata.mimeType || 'application/octet-stream';
  const inlineSafe = INLINE_SAFE_MIME.test(contentType);
  // 文件名可能来自上传者，必须剥离 CR/LF/引号，否则可以注入响应头
  const filename = encodeURIComponent(
    String(metadata.name || 'file').replace(/[\r\n"\\]/g, ''),
  );

  return new Response(res.value, {
    headers: {
      'Content-Type': inlineSafe ? contentType : 'application/octet-stream',
      'Content-Disposition': `${inlineSafe ? 'inline' : 'attachment'}; filename*=UTF-8''${filename}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      // id 随机且内容不可变，可以放心长缓存，省掉绝大多数 KV 读
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});

// ---------------------------------------------------------------------------
// 管理后台
// ---------------------------------------------------------------------------
//
// 三个设计约束，先讲清楚再看代码：
//
// 1. 为什么排序要绕这么大弯？
//    KV 的 list() 只保证 key 的字典序，既不返回创建时间也不认识业务时间。
//    所以「按上传时间排序」只能：写入时把 create_time 塞进 metadata，
//    列表时 includeMetadata 取回来在内存里排。
//    代价是：本次改动之前上传的老数据没有该字段，只能标记「时间未知」沉到列表底部。
//
// 2. 为什么摘要在 metadata 里？
//    列表要显示内容摘要就得回读 value，1000 条 = 1000 次 KV 读，又慢又费额度。
//    metadata 里存 40 字摘要后，列表接口零额外开销就能展示和搜索。
//
// 3. 鉴权
//    ADMIN_TOKEN 从 wrangler secret 注入。未配置就直接 503 禁用整个后台，
//    绝不出现「默认无口令」的管理入口。口令比较是常量时间，失败再拖 300ms。

type AdminItem = {
  id: string;
  type: 'text' | 'file';
  /** 老数据没有时间戳，用 null 表示并固定排在最后 */
  create_time: number | null;
  url: string;
  expiration?: number;
  language?: string;
  has_password?: boolean;
  name?: string;
  mimeType?: string;
  size?: number | null;
  preview?: string;
  ip?: string;
  ua?: string;
};

app.use('/api/admin/*', async (c, next) => {
  const expected = (c.env.ADMIN_TOKEN ?? '').trim();
  if (!expected) {
    return c.json(
      { error: 'Admin console disabled: ADMIN_TOKEN is not configured', code: 503 },
      503,
    );
  }

  const provided = (c.req.header('x-admin-token') ?? '').trim();
  if (!provided || !timingSafeEqual(provided, expected)) {
    // 就算比较失败也拖一下，抬高在线爆破的成本
    await new Promise((resolve) => setTimeout(resolve, 300));
    return c.json({ error: 'Unauthorized', code: 401 }, 401);
  }

  return next();
});

/** 汇总文本与文件的元信息，列表与搜索共用 */
async function collectItems(
  env: Bindings,
  origin: string,
  want: { text: boolean; file: boolean },
): Promise<{
  items: AdminItem[];
  textCount: number;
  fileCount: number;
}> {
  const [textKeys, fileKeys] = await Promise.all([
    want.text ? listAllKeys(env.PB) : Promise.resolve([]),
    want.file ? listAllKeys(env.PBIMGS) : Promise.resolve([]),
  ]);

  const items: AdminItem[] = [];

  for (const key of textKeys) {
    const meta = (key.metadata ?? {}) as Partial<PasteMetadata>;
    items.push({
      id: key.name,
      type: 'text',
      create_time: typeof meta.create_time === 'number' ? meta.create_time : null,
      url: `${origin}/detail/${key.name}`,
      expiration: key.expiration,
      language: meta.language ?? 'text',
      has_password: Boolean(meta.has_password),
      preview: meta.preview,
      ip: meta.ip,
      ua: meta.ua,
    });
  }

  for (const key of fileKeys) {
    const meta = (key.metadata ?? {}) as Partial<FileMetadata>;
    items.push({
      id: key.name,
      type: 'file',
      create_time: typeof meta.create_time === 'number' ? meta.create_time : null,
      url: `${origin}/file/${key.name}`,
      expiration: key.expiration,
      name: meta.name,
      mimeType: meta.mimeType,
      size: typeof meta.size === 'number' ? meta.size : null,
      ip: meta.ip,
      ua: meta.ua,
    });
  }

  return { items, textCount: textKeys.length, fileCount: fileKeys.length };
}

/** 按上传时间排序；时间未知的老数据固定沉底，不参与时间轴 */
function sortByTime(items: AdminItem[], order: 'asc' | 'desc'): void {
  items.sort((a, b) => {
    if (a.create_time === null && b.create_time === null) return a.id.localeCompare(b.id);
    if (a.create_time === null) return 1;
    if (b.create_time === null) return -1;
    const delta =
      order === 'asc' ? a.create_time - b.create_time : b.create_time - a.create_time;
    return delta !== 0 ? delta : a.id.localeCompare(b.id);
  });
}

/** 列表页的轻量匹配：只查元信息与摘要，不回读正文 */
function matchKeyword(item: AdminItem, keyword: string): boolean {
  return [item.id, item.name, item.mimeType, item.language, item.preview, item.ip, item.ua]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(keyword);
}

const ID_PATTERN = /^[0-9A-Za-z_-]{1,64}$/;

app.get('/api/admin/list', async (c) => {
  const type = c.req.query('type') ?? 'all';
  const keyword = (c.req.query('keyword') ?? '').trim().toLowerCase();
  const order = c.req.query('order') === 'asc' ? 'asc' : 'desc';
  const page = Math.max(1, Number(c.req.query('page') ?? 1) || 1);
  const pageSize = Math.min(
    ADMIN_PAGE_MAX,
    Math.max(1, Number(c.req.query('pageSize') ?? 20) || 20),
  );

  const { items, textCount, fileCount } = await collectItems(c.env, baseUrl(c), {
    text: type !== 'file',
    file: type !== 'text',
  });

  const unknownTime = items.filter((item) => item.create_time === null).length;
  const filtered = keyword ? items.filter((item) => matchKeyword(item, keyword)) : items;
  sortByTime(filtered, order);

  const total = filtered.length;
  const start = (page - 1) * pageSize;

  return c.json({
    items: filtered.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    textCount,
    fileCount,
    unknownTime,
    // 已经翻到扫描上限时提示，免得管理员误以为「东西就这么多」
    truncated:
      textCount >= 1000 * ADMIN_SCAN_MAX_PAGES || fileCount >= 1000 * ADMIN_SCAN_MAX_PAGES,
  });
});

/** 取单条完整内容：文本给正文，文件给元信息+直链 */
app.get('/api/admin/content', async (c) => {
  const id = c.req.query('id');
  const type = c.req.query('type') === 'file' ? 'file' : 'text';

  if (!id || !ID_PATTERN.test(id)) {
    return c.json({ error: 'Valid id is required', code: 400 }, 400);
  }

  if (type === 'file') {
    const res = await c.env.PBIMGS.getWithMetadata<FileMetadata>(id, 'arrayBuffer');
    if (!res.value) return c.json({ error: 'Not found', code: 404 }, 404);
    const meta = (res.metadata ?? {}) as Partial<FileMetadata>;
    return c.json({
      type: 'file',
      id,
      name: meta.name ?? 'file',
      mimeType: meta.mimeType ?? 'application/octet-stream',
      size: res.value.byteLength,
      create_time: meta.create_time ?? null,
      ip: meta.ip,
      ua: meta.ua,
      url: `${baseUrl(c)}/file/${id}`,
    });
  }

  const res = await c.env.PB.getWithMetadata<PasteMetadata>(id);
  if (!res.value) return c.json({ error: 'Not found', code: 404 }, 404);
  const meta = (res.metadata ?? {}) as Partial<PasteMetadata>;

  return c.json({
    type: 'text',
    id,
    content: res.value,
    language: meta.language ?? 'text',
    has_password: Boolean(meta.has_password),
    create_time: meta.create_time ?? null,
    ip: meta.ip,
    ua: meta.ua,
    url: `${baseUrl(c)}/detail/${id}`,
  });
});

/** 删除：支持单条与批量，前端一次最多提 200 条 */
app.post('/api/admin/delete', async (c) => {
  let body: { items?: unknown };
  try {
    body = (await c.req.json()) as { items?: unknown };
  } catch {
    return c.json({ error: 'Invalid JSON body', code: 400 }, 400);
  }

  const list = Array.isArray(body?.items) ? body.items : [];
  if (!list.length) {
    return c.json({ error: 'items is required', code: 400 }, 400);
  }
  if (list.length > 200) {
    return c.json({ error: 'Too many items in one request (max 200)', code: 400 }, 400);
  }

  const results = await Promise.all(
    list.map(async (raw) => {
      const id = typeof raw?.id === 'string' ? raw.id.trim() : '';
      const itemType: 'text' | 'file' = raw?.type === 'file' ? 'file' : 'text';

      if (!ID_PATTERN.test(id)) {
        return { id, type: itemType, ok: false, error: 'Invalid id' };
      }

      try {
        // 按类型删除，避免误删另一个 namespace 里的同名 id
        await (itemType === 'file' ? c.env.PBIMGS : c.env.PB).delete(id);
        return { id, type: itemType, ok: true };
      } catch (error) {
        console.error('[pastebin] delete failed:', itemType, id, error);
        return { id, type: itemType, ok: false, error: 'Delete failed' };
      }
    }),
  );

  const deleted = results.filter((item) => item.ok).length;
  return c.json({ deleted, failed: results.length - deleted, results });
});

/**
 * 深度排查：回读正文做全文匹配。
 * 列表页的搜索只覆盖元信息与摘要，要查正文里有没有关键词就得靠这个接口。
 * 为了不把 CPU 打满，扫描条数与并发都设了上限。
 */
const SEARCH_SCAN_MAX = 300;
const SEARCH_BATCH = 20;

app.get('/api/admin/search', async (c) => {
  const keyword = (c.req.query('keyword') ?? '').trim().toLowerCase();
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 30) || 30));

  if (keyword.length < 2) {
    return c.json({ error: 'keyword must be at least 2 characters', code: 400 }, 400);
  }

  const { items } = await collectItems(c.env, baseUrl(c), { text: true, file: false });
  sortByTime(items, 'desc');

  const hits: Array<AdminItem & { snippet: string }> = [];
  let scanned = 0;

  for (let offset = 0; offset < items.length; offset += SEARCH_BATCH) {
    if (hits.length >= limit || scanned >= SEARCH_SCAN_MAX) break;

    const batch = items.slice(offset, offset + SEARCH_BATCH);
    scanned += batch.length;

    const values = await Promise.all(batch.map((item) => c.env.PB.get(item.id)));

    values.forEach((value, index) => {
      if (!value || hits.length >= limit) return;
      const position = value.toLowerCase().indexOf(keyword);
      if (position === -1) return;
      const from = Math.max(0, position - 40);
      hits.push({
        ...batch[index],
        snippet: value
          .slice(from, position + keyword.length + 60)
          .replace(/\s+/g, ' '),
      });
    });
  }

  return c.json({
    items: hits,
    scanned,
    truncated: scanned >= SEARCH_SCAN_MAX,
    scanLimit: SEARCH_SCAN_MAX,
  });
});

export default app;
