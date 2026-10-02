// =============================================================================
// Supabase 链路自检 —— 在写任何前端代码之前，先把后端整条路跑通
//
//   node supabase/verify.mjs            只读检查（不写任何数据）
//   node supabase/verify.mjs --write    额外做一次「建草稿→加菜→确认→统计回写」全链路
//
// 配置：在 supabase/.env.local 里写两行
//   SB_URL=https://xxxxxxxx.supabase.co
//   SB_ANON_KEY=sb_publishable_xxxxxxxx
// （SB_ANON_KEY 放 Project Settings → API Keys 里那个 publishable 开头的；
//   如果你还没禁用 legacy，用旧的 anon JWT 也能跑）
//
// 它依次验证 7 件事：匿名登录 → RLS 真的挡住未加入家庭的人 → join_family
// → 能读到 30 道菜 → random_dish 的权重与 reasons → random_table 不重菜
// → confirm_order 会不会正确回写 eat_count
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WRITE_TEST = process.argv.includes('--write');

// ---------- 读配置 ----------
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

// *.supabase.co 在本机网络被 TLS reset，需要走代理。Node 的 global fetch 只在
// 进程启动前就设了 NODE_USE_ENV_PROXY 才会读代理变量，所以这里检测到配置了就
// 带着它重启自己 —— 用户仍然只需要 `node supabase/verify.mjs`。
if (env.HTTPS_PROXY && !process.env.NODE_USE_ENV_PROXY) {
  process.env.NODE_USE_ENV_PROXY = '1';
  process.env.HTTPS_PROXY = env.HTTPS_PROXY;
  process.env.HTTP_PROXY = env.HTTP_PROXY || env.HTTPS_PROXY;
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)],
                      { stdio: 'inherit', env: process.env });
  process.exit(r.status ?? 1);
}

// 容错：有人会把 PostgREST 的 /rest/v1 或 GraphQL 的 /graphql 后缀一起粘过来
const URL = (env.SB_URL || '')
  .replace(/\/(rest\/v1|graphql|auth\/v1|storage\/v1)\/?$/i, '')
  .replace(/\/+$/, '');
const KEY = env.SB_ANON_KEY;

if (!URL || !KEY) {
  console.error('缺配置。请新建 supabase/.env.local：\n  SB_URL=https://<ref>.supabase.co\n  SB_ANON_KEY=sb_publishable_...\n');
  process.exit(1);
}

let token = null;
const results = [];
function say(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
async function call(p, { method = 'GET', body, auth = false, prefer } = {}) {
  const headers = { apikey: KEY, 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = `Bearer ${token}`;
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(URL + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON 响应 */ }
  if (!res.ok) {
    const msg = json?.error_description || json?.message || json?.error || text.slice(0, 200);
    throw new Error(`HTTP ${res.status} ${msg}`);
  }
  return json ?? text;
}

console.log(`\n目标 ${URL}\n${'─'.repeat(64)}`);

// ---------- 1. 匿名登录 ----------
try {
  const r = await call('/auth/v1/signup', { method: 'POST', body: { anonymous: true } });
  token = r.access_token;
  const uid = r.user?.id;
  say('匿名登录拿到 access_token', !!token, uid ? `uid ${uid.slice(0, 8)}…` : '');
  if (!token) throw new Error('响应里没有 access_token');
} catch (e) {
  say('匿名登录', false, e.message);
  console.log('\n→ 大概率是 Auth → Providers 里的 Anonymous sign-ins 没打开。开完再跑一次。\n');
  process.exit(1);
}

// ---------- 2. RLS 必须挡住未加入家庭的人 ----------
try {
  const rows = await call('/rest/v1/dishes?select=id,name&limit=500', { auth: true });
  const n = Array.isArray(rows) ? rows.length : 0;
  say('未加入家庭时读不到任何菜（RLS 生效）', n === 0, n === 0 ? '0 行，正确' : `读到了 ${n} 行 —— RLS 没起作用，必须修`);
} catch (e) {
  say('RLS 隔离检查', false, e.message);
}

// ---------- 3. join_family ----------
try {
  const mem = await call('/rest/v1/rpc/join_family', { method: 'POST', body: { p_code: 'DEMO01', p_name: '自检设备' }, auth: true });
  say('join_family(DEMO01)', !!mem, `member ${String(mem).slice(0, 8)}…`);
} catch (e) {
  say('join_family', false, e.message);
  console.log('\n→ 如果提示「这台设备已经在一个家庭里」，说明之前 join 过，正常，继续看下面。\n');
}

// ---------- 4. 现在应该能读到 30 道菜 ----------
let dishes = [];
try {
  dishes = await call('/rest/v1/dishes?select=name,category,eat_count,last_eaten_at,is_active&order=name.asc', { auth: true });
  say('读到示范家庭的菜品', Array.isArray(dishes) && dishes.length >= 30, `${dishes.length} 道`);
  const withHistory = dishes.filter(d => d.eat_count > 0).length;
  console.log(`        其中 ${withHistory} 道有历史（eat_count>0），${dishes.length - withHistory} 道从没点过`);
  if (withHistory === 0) console.log('        ⚠ 全为 0 说明 seed 第 4 段的历史没灌进去，随机权重会没差别');
} catch (e) {
  say('读菜品', false, e.message);
}

// ---------- 5. random_dish ----------
try {
  const r = await call('/rest/v1/rpc/random_dish', { method: 'POST', body: { p_meal_type: '正餐', p_category: '荤菜', p_limit: 1 }, auth: true });
  const d = r?.[0];
  say('random_dish 返回带权重的结果', !!d && Array.isArray(d.reasons),
      d ? `${d.dish_name} · score ${d.score} · ${d.days_since} 天前吃过` : '空结果');
  if (d?.reasons?.length) {
    console.log('        reasons 条数 =', d.reasons.length, '（设计稿 .result .why 的六条权重条）');
    for (const x of d.reasons.slice(0, 3)) console.log(`          · ${x.label}：${x.detail}  (weight ${x.weight})`);
  }
} catch (e) {
  say('random_dish', false, e.message);
}

// ---------- 6. random_table 不能出重菜 ----------
try {
  const t = await call('/rest/v1/rpc/random_table', { method: 'POST', body: { p_people: 3, p_meal_type: '正餐' }, auth: true });
  const ids = (t || []).map(x => x.dish_id);
  const uniq = new Set(ids).size;
  say('random_table 一桌 4 槽且不重菜', ids.length === 4 && uniq === 4,
      t ? `${t.map(x => x.dish_name).join(' + ')}（${uniq}/${ids.length} 不重复）` : '空');
} catch (e) {
  say('random_table', false, e.message);
}

// ---------- 7. 可选：确认点餐全链路 ----------
if (WRITE_TEST) {
  const DEMO_FAMILY = '11111111-1111-1111-1111-111111111111';
  const today = new Date().toISOString().slice(0, 10);
  try {
    // 先清掉今天可能残留的自检单，让这一步可以反复跑
    await call(`/rest/v1/meal_orders?meal_date=eq.${today}&meal_type=eq.%E5%85%B6%E4%BB%96&status=eq.draft`,
      { method: 'DELETE', auth: true });

    const created = await call('/rest/v1/meal_orders?select=id,family_id,created_by,status', {
      method: 'POST', auth: true, prefer: 'return=representation',
      body: [{ meal_date: today, meal_type: '其他', status: 'draft' }],
    });
    const o = Array.isArray(created) ? created[0] : created;
    say('建草稿订单（不传 family_id）', !!o?.id, o ? `id ${o.id.slice(0, 8)}…` : '响应体为空');
    say('数据库自动盖上 family_id', o?.family_id === DEMO_FAMILY,
        `期望 ${DEMO_FAMILY.slice(0,8)}… 实得 ${String(o?.family_id).slice(0,8)}…`);
    say('数据库自动盖上 created_by', !!o?.created_by, o?.created_by ? '已填' : '为空');

    const target = dishes.find(d => d.name === '清炒小白菜') || dishes[0];
    const dishRow = await call(`/rest/v1/dishes?select=id,eat_count&name=eq.${encodeURIComponent(target.name)}&limit=1`, { auth: true });
    const before = dishRow[0].eat_count;

    await call('/rest/v1/meal_order_items', {
      method: 'POST', auth: true,
      body: [{ order_id: o.id, dish_id: dishRow[0].id, quantity: 1, category: target.category }],
    });

    // 故意连调两次：验证 confirm_order 幂等，不会把 eat_count 算成 +2
    await call('/rest/v1/rpc/confirm_order', { method: 'POST', body: { p_order: o.id }, auth: true });
    await call('/rest/v1/rpc/confirm_order', { method: 'POST', body: { p_order: o.id }, auth: true });

    const after = (await call(`/rest/v1/dishes?select=eat_count&name=eq.${encodeURIComponent(target.name)}&limit=1`, { auth: true }))[0].eat_count;
    say('confirm_order 幂等：重复调用只 +1', after - before === 1, `${target.name} ${before} → ${after}`);

    await call(`/rest/v1/meal_orders?id=eq.${o.id}`, { method: 'DELETE', auth: true });
    console.log('        （自检订单已清理，不污染示范数据）');
  } catch (e) {
    say('确认点餐链路', false, e.message);
  }
} else {
  console.log('  SKIP  确认点餐全链路（加 --write 开启，会往示范家庭写一条记录）');
}

// ---------- 汇总 ----------
console.log('─'.repeat(64));
const bad = results.filter(r => !r.ok);
if (bad.length) {
  console.log(`\n${bad.length} 项未通过：${bad.map(b => b.name).join(' / ')}\n`);
  process.exit(1);
}
console.log(`\n全部 ${results.length} 项通过 —— 后端可以开始接前端了。\n`);
