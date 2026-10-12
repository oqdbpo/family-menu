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
let uid = null;
const identities = [];        // 本次跑测创建的所有匿名身份，结尾统一清掉
const results = [];
function say(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
// tok 用来临时以另一个身份发请求（成员管理要在 A 的会话里操作 B 的行）
async function call(p, { method = 'GET', body, auth = false, prefer, tok } = {}) {
  const headers = { apikey: KEY, 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = `Bearer ${tok || token}`;
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

// 少数收尾动作（删掉本次创建的整站临时数据）REST 做不到，走 Management API。
// 缺令牌时返回 null 而不是抛错——自检结论不该被清理步骤绑架
async function mgmt(sql) {
  const REF = env.SB_PROJECT_REF, TOK = env.SB_MGMT_TOKEN;
  if (!REF || !TOK) return null;
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${t.slice(0, 120)}`);
  return t;
}

console.log(`\n目标 ${URL}\n${'─'.repeat(64)}`);

// ---------- 1. 匿名登录 ----------
try {
  const r = await call('/auth/v1/signup', { method: 'POST', body: { anonymous: true } });
  token = r.access_token;
  uid = r.user?.id;
  if (uid) identities.push(uid);
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

// ---------- 7. 成员管理：看得见 → 删自己必须被拒 → 删别人成功且真的消失 ----------
{
  const tag = `${Date.now() % 100000}`;
  const guestName = `临时成员${tag}`;
  let guest = null;          // { token, uid, member }
  try {
    const b = await call('/auth/v1/signup', { method: 'POST', body: { anonymous: true } });
    guest = { token: b.access_token, uid: b.user?.id };
    if (guest.uid) identities.push(guest.uid);
    guest.member = await call('/rest/v1/rpc/join_family',
      { method: 'POST', body: { p_code: 'DEMO01', p_name: guestName }, auth: true, tok: guest.token });

    const list = await call('/rest/v1/rpc/member_overview', { method: 'POST', body: {}, auth: true });
    const me = list.find(m => m.is_self);
    const g  = list.find(m => m.name === guestName);
    const ghosts = list.filter(m => !m.bound);
    say('member_overview 认得出我是谁', !!me && list.filter(m => m.is_self).length === 1,
        me ? `我 = ${me.name} · 共 ${list.length} 人（${ghosts.length} 个未绑设备）` : '没找到 is_self 行');
    say('新加入的设备被标成已绑定，种子占位标成未绑定',
        !!g && g.bound === true && ghosts.length === 3 && ghosts.every(x => x.bound === false),
        g ? `${guestName} bound=${g.bound}` : '列表里没有新成员');

    // 关键守卫：删自己必须被数据库拒绝，而不是靠前端藏按钮
    let refused = '';
    try {
      await call('/rest/v1/rpc/remove_member', { method: 'POST', body: { p_member: me.id }, auth: true });
    } catch (e) { refused = e.message; }
    say('remove_member 拒绝删自己', /不能删掉自己/.test(refused), refused || '没报错，被删掉了！');

    const removedName = await call('/rest/v1/rpc/remove_member',
      { method: 'POST', body: { p_member: guest.member }, auth: true });
    const after = await call('/rest/v1/rpc/member_overview', { method: 'POST', body: {}, auth: true });
    say('remove_member 删掉别人并返回其名',
        removedName === guestName && !after.some(m => m.name === guestName),
        `返回「${removedName}」· 剩下 ${after.length} 人`);

    // 别人的成员行删不掉（越权尝试：拿一个不存在的 uuid）
    let foreign = '';
    try {
      await call('/rest/v1/rpc/remove_member',
        { method: 'POST', body: { p_member: '00000000-0000-0000-0000-000000000000' }, auth: true });
    } catch (e) { foreign = e.message; }
    say('拿别处的 member id 来删会被挡', /家里没有这名成员/.test(foreign), foreign || '没报错');
  } catch (e) {
    say('成员管理链路', false, e.message);
  } finally {
    // 中途失败也别把临时成员留在示范家庭里
    if (guest?.member) {
      await call('/rest/v1/rpc/remove_member',
        { method: 'POST', body: { p_member: guest.member }, auth: true }).catch(() => {});
    }
  }
}

// ---------- 8. 管理员：只有现任能移交，没交出去就移不掉 ----------
// 用一个临时家庭跑，绝不碰 DEMO01 的演示数据，更不碰真家庭
{
  let scratch = null;
  try {
    const c = await call('/auth/v1/signup', { method: 'POST', body: { anonymous: true } });
    if (c.user?.id) identities.push(c.user.id);
    const f = await call('/rest/v1/rpc/create_family',
      { method: 'POST', body: { p_name: '验收临时家', p_owner_name: '甲' }, auth: true, tok: c.access_token });
    scratch = Array.isArray(f) ? f[0] : f;

    const d = await call('/auth/v1/signup', { method: 'POST', body: { anonymous: true } });
    if (d.user?.id) identities.push(d.user.id);
    await call('/rest/v1/rpc/join_family',
      { method: 'POST', body: { p_code: scratch.invite_code, p_name: '乙' }, auth: true, tok: d.access_token });

    const tc = c.access_token, td = d.access_token;
    const list1 = await call('/rest/v1/rpc/member_overview', { method: 'POST', body: {}, auth: true, tok: tc });
    const boss = list1.find(m => m.name === '甲'), deputy = list1.find(m => m.name === '乙');

    say('is_owner 认的是成员行上的 role，且全户只有一个',
        list1.length === 2 && boss?.is_owner === true && deputy?.is_owner === false,
        `甲 ${boss?.is_owner} / 乙 ${deputy?.is_owner}`);

    // 成功时把 remove_member 返回的人名存进 removed，失败时把拒绝理由当返回值传出去
    let removed = null;
    const grab = async (tok, who) => {
      try { removed = await call('/rest/v1/rpc/remove_member', { method: 'POST', body: { p_member: who }, auth: true, tok }); return ''; }
      catch (e) { return e.message; }
    };
    const tussle = async (tok, who) => {
      try { await call('/rest/v1/rpc/transfer_owner', { method: 'POST', body: { p_member: who }, auth: true, tok }); return ''; }
      catch (e) { return e.message; }
    };

    const m1 = await grab(td, boss.id);
    say('普通成员想移除现任管理员 → 被拒', /管理员/.test(m1) && /交给/.test(m1), m1 || '没报错，管理员被删了！');

    const m2 = await tussle(td, deputy.id);
    say('普通成员想给自己升管理员 → 被拒', /只有现任管理员/.test(m2), m2 || '没报错，自己封自己了');

    const gave = await call('/rest/v1/rpc/transfer_owner',
      { method: 'POST', body: { p_member: deputy.id }, auth: true, tok: tc });
    const list2 = await call('/rest/v1/rpc/member_overview', { method: 'POST', body: {}, auth: true, tok: tc });
    say('现任管理员移交后 is_owner 立刻换位',
        gave === '乙' && list2.find(x => x.name === '乙')?.is_owner === true
                  && list2.find(x => x.name === '甲')?.is_owner === false,
        `交给「${gave}」`);

    const m3 = await grab(tc, deputy.id);
    say('退位的前管理员想移走现任 → 照样被拒', /管理员/.test(m3), m3 || '没报错');

    const took = await grab(td, boss.id);
    const list3 = await call('/rest/v1/rpc/member_overview', { method: 'POST', body: {}, auth: true, tok: td });
    say('现任管理员能移除刚退位的那位', took === '' && removed === '甲' && list3.length === 1,
        took || `${removed} 已被移除，剩下 ${list3.map(x => x.name).join('、')}`);
  } catch (e) {
    say('管理员移交链路', false, e.message);
  } finally {
    // 临时家庭连成员一起拆掉，不给示范库留垃圾
    if (scratch?.family_id) await mgmt(`delete from families where id = '${scratch.family_id}'::uuid;`).catch(() => {});
  }
}

// ---------- 9. 反悔链路：确认→取消 要把全户统计一分不差地退回去 ----------
// 这是新加的不变量。单看某一道菜的 +1 / -1 是不够的：统计的正确性标准是
// "退回去之后和从没动过一样"，所以整户 eat_count + last_eaten_at 逐个比对。
// 挑一道**本来就有历史**的菜，才能验证 last_eaten_at 退回的是旧的时间戳 ——
// 纯增量 -1 的写法永远做不到这件事。
{
  const iso = d => d.toISOString().slice(0, 10);
  const tomorrow = iso(new Date(Date.now() + 864e5));
  const made = [];
  const snap = () => call('/rest/v1/dishes?select=id,eat_count,last_eaten_at&order=id.asc', { auth: true })
    .then(r => JSON.stringify(r.map(x => `${x.id}=${x.eat_count}/${x.last_eaten_at ?? ''}`)));
  try {
    const zero0 = await snap();
    const pool = await call('/rest/v1/dishes?select=id,name,category,eat_count,last_eaten_at&order=last_eaten_at.desc.nullslast&limit=1', { auth: true });
    const dish = pool[0];

    const mk = async (meal) => {
      const id = crypto.randomUUID();
      await call('/rest/v1/meal_orders', {
        method: 'POST', auth: true,
        body: [{ id, meal_date: tomorrow, meal_type: meal, status: 'draft' }],
      });
      made.push(id);
      return id;
    };

    const o1 = await mk('晚餐');
    await call('/rest/v1/meal_order_items', {
      method: 'POST', auth: true,
      body: [{ order_id: o1, dish_id: dish.id, quantity: 1, category: dish.category }],
    });

    await call('/rest/v1/rpc/confirm_order', { method: 'POST', body: { p_order: o1 }, auth: true });
    const mid = await call(`/rest/v1/dishes?select=eat_count,last_eaten_at&id=eq.${dish.id}`, { auth: true });
    say('确认后该菜 +1 且 last_eaten_at 变成现在',
        mid[0].eat_count === dish.eat_count + 1 && mid[0].last_eaten_at !== dish.last_eaten_at,
        `${dish.name} ${dish.eat_count} → ${mid[0].eat_count}`);

    await call('/rest/v1/rpc/cancel_order', { method: 'POST', body: { p_order: o1 }, auth: true });
    say('取消确认后全户统计逐字退回原状', (await snap()) === zero0,
        '整户 eat_count / last_eaten_at 全量比对不一致');

    await call('/rest/v1/rpc/cancel_order', { method: 'POST', body: { p_order: o1 }, auth: true });
    say('取消是幂等的（再点一次不报错也不动数字）', (await snap()) === zero0);

    // 过去那一顿是历史，数据库必须拦住，不能只靠前端不给按钮。
    // 取"前天或更早"而不是"昨天"：Supabase 会话时区是 UTC，家里是 UTC+8，
    // 北京时间 00:00–08:00 之间"昨天"在服务端还没跨天，用它做断言会时好时坏。
    const hist = await call('/rest/v1/meal_orders?select=id,meal_date,status&status=eq.confirmed&order=meal_date.asc&limit=40', { auth: true });
    const cutoff = iso(new Date(Date.now() - 2 * 864e5));
    const past = hist.find(x => x.meal_date <= cutoff);
    let pastErr = '';
    if (past) {
      try { await call('/rest/v1/rpc/cancel_order', { method: 'POST', body: { p_order: past.id }, auth: true }); }
      catch (e) { pastErr = e.message; }
      say('取消以前吃过的顿 → 被数据库拒绝', /历史/.test(pastErr), pastErr || `${past.meal_date} 竟然能取消`);
    } else {
      console.log('  SKIP  过去日期的守卫（这个家没有两天以上的历史订单可试）');
    }

    // 挪动：明天晚餐此时被 o1 占着，正好当"已有单"的障碍
    const slotOf = async (meal) => {
      const rows = await call(`/rest/v1/meal_orders?select=id&meal_date=eq.${tomorrow}&meal_type=eq.${meal}`, { auth: true });
      return rows[0]?.id || null;
    };

    const o2 = await mk('午餐');
    let movedErr = '';
    try {
      await call('/rest/v1/rpc/move_order',
        { method: 'POST', body: { p_order: o2, p_date: tomorrow, p_meal_type: '早餐' }, auth: true });
    } catch (e) { movedErr = e.message; }
    say('草稿挪进空位成功', movedErr === '' && (await slotOf('早餐')) === o2 && (await slotOf('午餐')) === null,
        movedErr || `早餐=${(await slotOf('早餐')) === o2 ? 'o2' : '?'} 午餐=${(await slotOf('午餐')) ? '还占着' : '空'}`);

    const o3 = await mk('其他');
    let clash = '';
    try {
      await call('/rest/v1/rpc/move_order',
        { method: 'POST', body: { p_order: o3, p_date: tomorrow, p_meal_type: '晚餐' }, auth: true });
    } catch (e) { clash = e.message; }
    say('挪到已有单的位置 → 拒绝并点名是哪一顿', /已经有一单/.test(clash), clash || '没报错，两单被并了');
    say('被拒绝时两边都没动', (await slotOf('晚餐')) === o1 && (await slotOf('其他')) === o3,
        `晚餐=${(await slotOf('晚餐')) === o1 ? 'o1' : '?'} 其他=${(await slotOf('其他')) === o3 ? 'o3' : '?'}`);

    // 已确认的不许挪，必须先取消——"确认即冻结"这条留着（指向刚腾空的午餐，避开障碍干扰）
    await call('/rest/v1/rpc/confirm_order', { method: 'POST', body: { p_order: o3 }, auth: true });
    let frozen = '';
    try {
      await call('/rest/v1/rpc/move_order',
        { method: 'POST', body: { p_order: o3, p_date: tomorrow, p_meal_type: '午餐' }, auth: true });
    } catch (e) { frozen = e.message; }
    await call('/rest/v1/rpc/cancel_order', { method: 'POST', body: { p_order: o3 }, auth: true });
    say('已确认的顿不能直接挪，得先取消', /先取消确认/.test(frozen), frozen || '没报错');
  } catch (e) {
    say('反悔链路', false, e.message);
  } finally {
    for (const id of made) {
      await call(`/rest/v1/meal_orders?id=eq.${id}`, { method: 'DELETE', auth: true }).catch(() => {});
    }
  }
}

// ---------- 10. 可选：确认点餐全链路 ----------
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

// ---------- 11. 名字即身份（方案 C）----------
// 换手机 / 清过数据 / 开无痕 = 新的匿名 uid。旧实现把 uid 当人，于是同一个人长出两条
// 成员行，偏好、订单、管理员全留在旧行上 —— 这就是"妈妈重新登录后就不是她了"的根因。
// 现在按名字认领：同一家里同名 = 同一个人，auth_uid 只表示"此刻哪台设备在代表她"。
// 明确接受的代价：知道邀请码的人就能认领任意身份，包括管理员（第 ⑨ 条就是把它测出来，
// 别当 bug 复查）。所以整户只有临时家庭，绝不碰 DEMO01 和真家庭。
{
  let scratch = null;
  const sign = async () => {
    const r = await call('/auth/v1/signup', { method: 'POST', body: { anonymous: true } });
    if (r.user?.id) identities.push(r.user.id);
    return r.access_token;
  };
  const join = (tok, p_code, p_name) => call('/rest/v1/rpc/join_family',
    { method: 'POST', body: { p_code, p_name }, auth: true, tok });
  const overview = (tok) => call('/rest/v1/rpc/member_overview', { method: 'POST', body: {}, auth: true, tok });
  try {
    const momA = await sign();                       // 妈妈的第一台设备
    const f = await call('/rest/v1/rpc/create_family',
      { method: 'POST', body: { p_name: '身份自检家', p_owner_name: '妈妈' }, auth: true, tok: momA });
    scratch = Array.isArray(f) ? f[0] : f;
    const code = scratch.invite_code;

    // ① 本项检查的核心：第二台设备凭名字回来，必须落回同一条成员行
    const momB = await sign();
    const claimed = await join(momB, code, '妈妈');
    say('换设备凭名字认领回同一个人（不产生新成员行）',
        claimed === scratch.member_id,
        `首台 ${String(scratch.member_id).slice(0, 8)}… / 次台 ${String(claimed).slice(0, 8)}…`);

    const list = await overview(momB);
    say('认领后全户仍只有 1 人，管理员身份跟着人走',
        list.length === 1 && list[0].name === '妈妈' && list[0].is_owner === true && list[0].is_self === true,
        `${list.length} 人：${list.map(x => x.name + (x.is_owner ? '(owner)' : '')).join('、')}`);

    // ② 一个名字同一时间只认一台：被顶掉的那台应该退回"没加入任何家庭"
    const kicked = await overview(momA);
    const blind = await call('/rest/v1/dishes?select=id&limit=99', { auth: true, tok: momA });
    say('被顶掉的老设备读不到家庭（一个名字同一时间只认一台）',
        kicked.length === 0 && blind.length === 0,
        `老设备看到 ${kicked.length} 人 / ${blind.length} 道菜`);

    // ③ 大小写和首尾空格差不算两个人：join 里 trim、唯一索引里 lower
    const grandma = await sign();
    const g1 = await join(grandma, code, 'yeye');
    const grandpa = await sign();
    const g2 = await join(grandpa, code, ' YEYE ');
    say('名字大小写 / 首尾空格差异仍认领到同一个人', g1 === g2, `${String(g1).slice(0, 8)}… vs ${String(g2).slice(0, 8)}…`);

    // ④ 起个新名字只能造出普通成员 —— owner 只能来自 create_family 或 transfer_owner
    const kid = await sign();
    const kidId = await join(kid, code, '孩子');
    const kidRow = (await overview(kid)).find(x => x.id === kidId);
    say('拿邀请码新建名字建不出管理员', kidRow && kidRow.is_owner === false && kidRow.role === 'member',
        kidRow ? `${kidRow.name} role=${kidRow.role}` : '没找到新成员行');

    // ⑤ 加入页的名单：码对给名单，码错给空数组（不报错，免得被拿来枚举有效邀请码）
    const roster = await call('/rest/v1/rpc/family_roster', { method: 'POST', body: { p_code: code } });
    const wrong = await call('/rest/v1/rpc/family_roster', { method: 'POST', body: { p_code: 'NOPE99' } });
    say('family_roster 码对给名单、码错给空（不泄邀请码有效性）',
        Array.isArray(roster) && roster.length === 3 && roster.some(x => x.is_owner) && Array.isArray(wrong) && wrong.length === 0,
        `${Array.isArray(roster) ? roster.map(x => x.name).join('、') : '非数组'} / 错码得 ${JSON.stringify(wrong)}`);

    // ⑥ 改名撞车要说人话（postgres 的 23505 原文没人看得懂），且两边都不动
    let collide = '';
    try { await call('/rest/v1/rpc/rename_self', { method: 'POST', body: { p_name: '妈妈' }, auth: true, tok: kid }); }
    catch (e) { collide = e.message; }
    const stillThere = await overview(kid);
    say('改名撞车被拒且提示能读，谁都没动',
        /家里已经有叫/.test(collide) && stillThere.length === 3
        && stillThere.find(x => x.id === kidId)?.name === '孩子',
        collide || '没报错，两个人重名了');

    // ⑦ 唯一索引兜底：绕过函数直接插重名也得被拒（前端/别的客户端都躲不过）
    let dupErr = '';
    try {
      await mgmt(`insert into public.family_members (family_id, name) values ('${scratch.family_id}'::uuid, '妈妈');`);
    } catch (e) { dupErr = e.message; }
    say('直接往库里插重名被唯一索引挡住', /member_name_uniq|23505|duplicate key/i.test(dupErr), dupErr || '竟然插进去了');

    // ⑧ 权限认 role 不认设备：认领回管理员的那台设备照样能改家庭名，普通成员不能
    const renamed = await call(`/rest/v1/families?id=eq.${scratch.family_id}`, {
      method: 'PATCH', auth: true, tok: momB, prefer: 'return=representation', body: { name: '改名成功' },
    });
    const denied = await call(`/rest/v1/families?id=eq.${scratch.family_id}`, {
      method: 'PATCH', auth: true, tok: kid, prefer: 'return=representation', body: { name: '普通成员想改名' },
    });
    say('管理员权限跟着 role 走（老设备被顶掉后新设备仍能改家庭名，普通成员改不动）',
        renamed.length === 1 && renamed[0].name === '改名成功' && denied.length === 0,
        `owner 改到 ${renamed.length} 行 / member 改到 ${denied.length} 行`);

    // ⑨ 设计如此，不是漏洞：任何拿到邀请码的设备都能认领管理员那一行
    const intruder = await sign();
    const took = await join(intruder, code, '妈妈');
    const afterIntrude = await overview(intruder);
    say('【设计如此】知道邀请码即可认领任意身份，含管理员',
        took === scratch.member_id && afterIntrude.find(x => x.name === '妈妈')?.is_self === true,
        '挡住外人只靠"邀请码不外泄"，数据库不设第二道门');
  } catch (e) {
    say('名字即身份链路', false, e.message);
  } finally {
    if (scratch?.family_id) await mgmt(`delete from families where id = '${scratch.family_id}'::uuid;`).catch(() => {});
  }
}

// ---------- 12. 自清理：删掉本次创建的所有匿名身份 ----------
// 第 2 项检查的前提是"这个会话还没加入任何家庭"，所以每轮都必须新签一个身份，
// 不能复用缓存 token。代价是不管的话，示范家庭里会一路堆陌生成员
// （实测几轮下来攒了 4 个"新成员/自检设备"）。默认自己擦干净；
// 想在 app 里以这个身份看现场，加 --keep-session。
// auth.users 上 family_members 是 on delete cascade，删身份即连带删成员行。
{
  const keep = process.argv.includes('--keep-session');
  // uid 来自服务端 auth，仍然先验一遍格式再拼进 SQL
  const uuids = identities.filter(u => /^[0-9a-f-]{36}$/i.test(String(u)));
  if (keep) {
    console.log(`  SKIP  自清理（--keep-session）—— 保留 ${uuids.length} 个身份`);
  } else if (!uuids.length) {
    console.log('  SKIP  自清理（本轮没有可删身份）');
  } else {
    const REF = env.SB_PROJECT_REF, TOK = env.SB_MGMT_TOKEN;
    if (!REF || !TOK) {
      console.log('  SKIP  自清理（supabase/.env.local 缺 SB_PROJECT_REF / SB_MGMT_TOKEN）');
      console.log(`        ${uuids.length} 个身份留在库里：${uuids.map(u => u.slice(0, 8)).join(' ')}`);
    } else {
      try {
        const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: `delete from auth.users where id in (${uuids.map(u => `'${u}'::uuid`).join(', ')});` }),
        });
        const t = await r.text();
        if (!r.ok) throw new Error(`HTTP ${r.status} ${t.slice(0, 120)}`);
        console.log(`        自清理：已删除本次 ${uuids.length} 个匿名身份（连带其成员行）`);
      } catch (e) {
        console.log(`  WARN  自清理失败，身份可能残留 —— ${e.message}`);
      }
    }
  }
}

// ---------- 汇总 ----------
console.log('─'.repeat(64));
const bad = results.filter(r => !r.ok);
if (bad.length) {
  console.log(`\n${bad.length} 项未通过：${bad.map(b => b.name).join(' / ')}\n`);
  process.exit(1);
}
console.log(`\n全部 ${results.length} 项通过 —— 后端可以开始接前端了。\n`);
