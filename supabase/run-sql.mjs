// =============================================================================
// 用 Management API 直接执行 SQL 文件，省掉在 Dashboard SQL Editor 里手动粘贴
//
//   node supabase/run-sql.mjs supabase/migrations/0001_init.sql
//   node supabase/run-sql.mjs supabase/seed.sql
//
// 需要 supabase/.env.local 里的 SB_PROJECT_REF + SB_MGMT_TOKEN
//
// 注意：Management API 的 database/query 端点不是公开稳定契约，Supabase 可能改名。
// 如果这里 404，说明你当前账号/区域不支持，退回 Dashboard → SQL Editor 手动粘贴即可，
// 脚本会把服务端原文错误打出来，不会假装成功。
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const file = process.argv[2];

function loadEnv() {
  const out = {};
  const f = path.join(HERE, '.env.local');
  if (fs.existsSync(f)) {
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return { ...out, ...process.env };
}

if (!file) {
  console.error('用法：node supabase/run-sql.mjs <sql 文件路径>');
  process.exit(1);
}
const abs = path.isAbsolute(file) ? file : path.join(ROOT, file);
if (!fs.existsSync(abs)) {
  console.error(`找不到文件：${abs}`);
  process.exit(1);
}

const env = loadEnv();
const REF = env.SB_PROJECT_REF, TOK = env.SB_MGMT_TOKEN;
if (!REF || !TOK) {
  console.error('缺配置：supabase/.env.local 里的 SB_PROJECT_REF 和 SB_MGMT_TOKEN');
  process.exit(1);
}

const sql = fs.readFileSync(abs, 'utf8');
console.log(`\n执行 ${file}  (${(sql.length / 1024).toFixed(1)} KB)`);

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});

const text = await res.text();
if (!res.ok) {
  console.error(`\nHTTP ${res.status}\n${text.slice(0, 2000)}`);
  if (res.status === 404) {
    console.error('\n→ 这个端点在你的项目上不可用。退回手动方式：');
    console.error('  Dashboard → SQL Editor → New query → 粘贴整个文件内容 → Run');
  } else if (res.status === 401) {
    console.error('\n→ PAT 无效或权限不够。重新生成一个勾了 Projects: Read/Write 的。');
  }
  process.exit(1);
}

let parsed = null;
try { parsed = JSON.parse(text); } catch { /* 有些版本返回纯文本 */ }
console.log(`服务端返回 HTTP ${res.status}`);
if (Array.isArray(parsed)) {
  console.log(parsed.length ? `结果 ${parsed.length} 行：` + JSON.stringify(parsed.slice(0, 5)) : 'Success. No rows returned.');
} else if (parsed && typeof parsed === 'object') {
  console.log(JSON.stringify(parsed).slice(0, 800));
} else {
  console.log(String(text).slice(0, 800) || '(空响应)');
}
console.log('完成。\n');
