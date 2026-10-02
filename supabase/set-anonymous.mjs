// =============================================================================
// 绕开 Dashboard UI，用 Supabase Management API 开启「匿名登录」
//
//   node supabase/set-anonymous.mjs            查看当前状态 + 尝试开启
//   node supabase/set-anonymous.mjs --check    只看不改
//
// 需要 supabase/.env.local 里有：
//   SB_PROJECT_REF=abcdefghij
//   SB_MGMT_TOKEN=sbp_xxxxxxxx
//
// PAT 在 https://supabase.com/dashboard/account/tokens 生成，
// 权限勾 Projects: Read/Write 即可。
//
// 这个脚本故意不写死字段名：它先把项目的 auth 配置整个拉下来，
// 找出所有名字里带 anonymous 的键，再按语义决定该设成 true 还是 false。
// 因为 Supabase 后台改版频繁，字段名和 UI 位置都可能变，配置项本身不会。
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECK_ONLY = process.argv.includes('--check');

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
const env = loadEnv();
const REF = env.SB_PROJECT_REF;
const TOK = env.SB_MGMT_TOKEN;

if (!REF || !TOK) {
  console.error('缺配置。supabase/.env.local 里补两行：\n  SB_PROJECT_REF=<你项目URL中间那段>\n  SB_MGMT_TOKEN=sbp_...\n');
  process.exit(1);
}

const API = 'https://api.supabase.com/v1';
const H = { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' };

async function req(method, url, body) {
  const res = await fetch(url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { ok: res.ok, status: res.status, json, text };
}

// 1) 先确认 token 能用、项目存在
const proj = await req('GET', `${API}/projects/${REF}`);
if (!proj.ok) {
  console.error(`读项目失败 HTTP ${proj.status}：${proj.text.slice(0, 300)}`);
  console.error('→ 检查 SB_PROJECT_REF 是否等于你 Project URL 中间那段，以及 PAT 是否有效。');
  process.exit(1);
}
console.log(`\n项目 ${proj.json.name}  区域 ${proj.json.region}  状态 ${proj.json.status ?? '—'}`);

// 2) 拉 auth 配置，找出所有跟 anonymous 有关的键
const cfgRes = await req('GET', `${API}/projects/${REF}/config/auth`);
if (!cfgRes.ok || !cfgRes.json) {
  console.error(`\n读 auth 配置失败 HTTP ${cfgRes.status}：${cfgRes.text.slice(0, 300)}`);
  console.error('→ 这个端点名可能变了。把上面的错误发回来。');
  process.exit(1);
}

const cfg = cfgRes.json;
const keys = Object.keys(cfg);
const anonKeys = keys.filter(k => /anon/i.test(k));

console.log(`\nauth 配置共 ${keys.length} 项，其中与匿名登录相关的：`);
if (!anonKeys.length) {
  console.log('  （一个都没找到 —— 说明这个端点返回的不是 GoTrue 全量配置）');
  console.log('\n前 40 个键名供你比对：');
  console.log('  ' + keys.slice(0, 40).join('\n  '));
  process.exit(2);
}
for (const k of anonKeys) console.log(`  ${k} = ${JSON.stringify(cfg[k])}`);

// 3) 决定要设成什么
//    只认「开关型」的键，忽略 rate_limit_ 这类数值配置。
//    disable_/block_/deny_  → 设 false
//    allow_/enable_/..._enabled → 设 true
const patch = {};
let classified = 0;
for (const k of anonKeys) {
  const lk = k.toLowerCase();
  const cur = cfg[k];

  if (typeof cur !== 'boolean') {
    console.log(`\n${k} 不是布尔开关（当前 ${JSON.stringify(cur)}），跳过`);
    continue;
  }
  classified++;

  let want;
  if (/^(disable|block|deny|revoke)_|_disabled?$/.test(lk)) want = false;
  else if (/^(allow|enable)_|_enabled?$/.test(lk)) want = true;
  else { console.log(`\n${k} 语义不明（当前 ${cur}），不动它，请人工确认`); continue; }

  if (cur === want) console.log(`\n${k} 已是 ${want}，无需改`);
  else { patch[k] = want; console.log(`\n将设 ${k} = ${want}（原 ${cur}）`); }
}

if (!classified) {
  console.error('\n找到 anonymous 相关键，但没一个是能判断方向的布尔开关。把上面的输出发回来人工处理。');
  process.exit(2);
}
if (!Object.keys(patch).length) {
  console.log('\n已经是开启状态。直接去跑 node supabase/verify.mjs');
  process.exit(0);
}
if (CHECK_ONLY) {
  console.log(`\n--check 模式，不修改。要开启就去掉 --check 重跑。`);
  process.exit(0);
}

// 4) 写回
const put = await req('PATCH', `${API}/projects/${REF}/config/auth`, patch);
if (!put.ok) {
  console.error(`\nPATCH 失败 HTTP ${put.status}：${put.text.slice(0, 400)}`);
  console.error('→ 若提示权限不足，去 Dashboard → Account → Personal Access Tokens 重新生成一个带写权限的。');
  process.exit(1);
}

// 5) 复查
const after = await req('GET', `${API}/projects/${REF}/config/auth`);
console.log('\n改后复查：');
for (const k of anonKeys) console.log(`  ${k} = ${JSON.stringify(after.json?.[k])}`);
console.log('\n配置生效通常要等 10–30 秒。之后跑：\n  node supabase/verify.mjs\n');
