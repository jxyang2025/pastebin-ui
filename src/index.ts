import { KVNamespace, KVNamespacePutOptions } from '@cloudflare/workers-types';
import { Hono } from 'hono';
import { serveStatic } from 'hono/cloudflare-workers';
import { customAlphabet } from 'nanoid';

import config from './config';

/** KV 单值上限 25MB */
const MAX_TEXT_SIZE = 1024 * 1024 * 25;
const MAX_FILE_SIZE = 1024 * 1024 * 25;

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
};

type PasteMetadata = {
  language: string;
  create_time: number;
  has_password?: boolean;
  share_password_hash?: string;
  share_password_salt?: string;
};

type FileMetadata = {
  mimeType: string;
  name: string;
};

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

// ---------------------------------------------------------------------------
// 中间件
// ---------------------------------------------------------------------------

app.use('/api/*', async (c, next) => {
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

export default app;
