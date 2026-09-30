#!/usr/bin/env node
/**
 * 由 wrangler.toml.example 生成 wrangler.toml。
 *
 * 目的：让真实凭据（account_id / KV namespace id）永远不进入 git 仓库，
 *       只在 CI 运行时通过 GitHub Secrets / Variables 注入。
 *
 * 读取的环境变量：
 *   CF_ACCOUNT_ID       Cloudflare Account ID            （可选，wrangler 也会读 CLOUDFLARE_ACCOUNT_ID）
 *   PB_KV_ID            文本 KV namespace id              （必填）
 *   PBIMGS_KV_ID        文件 KV namespace id              （必填）
 *   BASE_URL            站点地址，如 https://note.521986.xyz（必填）
 *   ALLOWED_ORIGINS     允许跨域的来源，逗号分隔，默认取 BASE_URL
 *   FORCE=1             已存在 wrangler.toml 时强制覆盖
 *
 * 用法：
 *   CF_ACCOUNT_ID=xxx PB_KV_ID=xxx PBIMGS_KV_ID=xxx BASE_URL=https://x.com \
 *     node scripts/gen-wrangler.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tplPath = resolve(root, 'wrangler.toml.example');
const outPath = resolve(root, 'wrangler.toml');

const required = ['PB_KV_ID', 'PBIMGS_KV_ID', 'BASE_URL'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`[gen-wrangler] 缺少必需的环境变量: ${missing.join(', ')}`);
  process.exit(1);
}

if (existsSync(outPath) && process.env.FORCE !== '1') {
  console.log('[gen-wrangler] wrangler.toml 已存在，跳过生成（需要覆盖请设置 FORCE=1）');
  process.exit(0);
}

const baseUrl = String(process.env.BASE_URL).replace(/\/+$/, '');
let host = '';
try {
  host = new URL(baseUrl).host;
} catch {
  console.error(`[gen-wrangler] BASE_URL 不是合法 URL: ${baseUrl}`);
  process.exit(1);
}

const replacements = {
  __CF_ACCOUNT_ID__: process.env.CF_ACCOUNT_ID ?? '',
  __PB_KV_ID__: process.env.PB_KV_ID,
  __PBIMGS_KV_ID__: process.env.PBIMGS_KV_ID,
  __BASE_URL__: baseUrl,
  __BASE_URL_HOST__: host,
  __ALLOWED_ORIGINS__:
    process.env.ALLOWED_ORIGINS ?? `${baseUrl},http://localhost:5173`,
};

let content = readFileSync(tplPath, 'utf8');
for (const [key, value] of Object.entries(replacements)) {
  content = content.split(key).join(value);
}

// account_id 留空时整行注释掉，交给 wrangler 从环境变量读取
if (!process.env.CF_ACCOUNT_ID) {
  content = content.replace(/^account_id\s*=.*$/m, (line) => `# ${line}`);
}

const leftovers = content.match(/__[A-Z_]+__/g);
if (leftovers) {
  console.error(`[gen-wrangler] 仍有未替换的占位符: ${[...new Set(leftovers)].join(', ')}`);
  process.exit(1);
}

writeFileSync(outPath, content, 'utf8');
console.log(`[gen-wrangler] 已生成 ${outPath}`);
