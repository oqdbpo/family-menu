// 把 design/assets 里的菜品插画传到 Supabase Storage，并回填 dishes.image_path
//   node supabase/upload-images.mjs
//
// 走的是真实用户路径：匿名登录 → join_family → 按 RLS 要求把文件放进
// {family_id}/ 目录下。所以这个脚本同时也是 Storage 策略的验收测试。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

function loadEnv() {
  const o = {};
  const f = path.join(HERE, '.env.local');
  for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return { ...o, ...process.env };
}
const env = loadEnv();

if (env.HTTPS_PROXY && !process.env.NODE_USE_ENV_PROXY) {
  process.env.NODE_USE_ENV_PROXY = '1';
  process.env.HTTPS_PROXY = env.HTTPS_PROXY;
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)],
                      { stdio: 'inherit', env: process.env });
  process.exit(r.status ?? 1);
}

const URL = (env.SB_URL || '').replace(/\/(rest\/v1|storage\/v1)\/?$/i, '').replace(/\/+$/, '');
const KEY = env.SB_ANON_KEY;
if (!URL || !KEY) { console.error('缺 SB_URL / SB_ANON_KEY'); process.exit(1); }

// 文件名 → 菜名。对不上的就跳过，不硬凑
const MAP = {
  'dish-kungpao':     '宫保鸡丁',
  'dish-laziji':      '辣子鸡',
  'dish-pepperchicken':'青椒炒鸡',
  'dish-chickenstir': '木耳小炒鸡',
  'dish-ribs':        '红烧排骨',
  'dish-tomatoegg':   '西红柿炒鸡蛋',
  'dish-greens':      '清炒小白菜',
  'dish-soup':        '紫菜蛋花汤',
  'dish-rice':        '米饭',
  'dish-hotpot':      '番茄锅底',
  'dish-breakfast':   '葱油拌面',
};

const sb = createClient(URL, KEY, { auth: { persistSession: false, detectSessionInUrl: false } });

const { data: s, error: se } = await sb.auth.getSession();
if (!s.session) {
  const r = await sb.auth.signInAnonymously();
  if (r.error) { console.error('匿名登录失败：', r.error.message); process.exit(1); }
}
const { data: mem, error: je } = await sb.rpc('join_family', { p_code: 'DEMO01', p_name: '插画导入' });
if (je) { console.error('join_family 失败：', je.message); process.exit(1); }

const { data: fam } = await sb.from('families').select('id,name').limit(1).single();
console.log(`家庭 ${fam.name}  ${fam.id}`);

const dir = path.join(ROOT, 'design', 'assets');
let ok = 0, skip = 0;
for (const [file, dishName] of Object.entries(MAP)) {
  const src = path.join(dir, `${file}.png`);
  if (!fs.existsSync(src)) { console.log(`  跳过  ${dishName}（没有 ${file}.png）`); skip++; continue; }

  const { data: dish, error: de } = await sb.from('dishes').select('id,name')
    .eq('name', dishName).eq('family_id', fam.id).maybeSingle();
  if (de) { console.error(`  失败  ${dishName}: ${de.message}`); skip++; continue; }
  if (!dish) { console.log(`  跳过  ${dishName}（库里没这道菜）`); skip++; continue; }

  const key = `${fam.id}/${file}.png`;
  const buf = fs.readFileSync(src);
  const { error: ue } = await sb.storage.from('dish-images')
    .upload(key, buf, { contentType: 'image/png', upsert: true });
  if (ue) { console.error(`  上传失败 ${dishName}: ${ue.message}`); skip++; continue; }

  const { error: pe } = await sb.from('dishes').update({ image_path: key }).eq('id', dish.id);
  if (pe) { console.error(`  回填失败 ${dishName}: ${pe.message}`); skip++; continue; }
  console.log(`  完成  ${dishName.padEnd(8)} ← ${key}  (${(buf.length / 1024).toFixed(0)}KB)`);
  ok++;
}

console.log(`\n上传 ${ok} 张，跳过 ${skip} 张。`);
const { count } = await sb.from('dishes').select('id', { count: 'exact', head: true }).is('image_path', null);
console.log(`仍缺图的菜品：${count ?? '?'} 道 —— 这些将来由家人用手机拍，不靠 AI 补。`);
