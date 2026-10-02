// 从 supabase/.env.local 生成前端用的 .env，省得手抄一遍
//   node tools/gen-env.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const src = path.join(ROOT, 'supabase', '.env.local');
if (!fs.existsSync(src)) {
  console.error('找不到 supabase/.env.local');
  process.exit(1);
}

const read = f => {
  const o = {};
  for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return o;
};
const s = read(src);
if (!s.SB_URL || !s.SB_ANON_KEY) {
  console.error('supabase/.env.local 里缺 SB_URL 或 SB_ANON_KEY');
  process.exit(1);
}

// 反代上线后把 SB_PROXY_URL 填上，本地开发就能不走系统代理直连；
// 没填则维持原样。CI 那边对应的开关是 Actions Variables 里的 SB_URL。
const url = s.SB_PROXY_URL || s.SB_URL;

fs.writeFileSync(path.join(ROOT, '.env'),
  `# 由 tools/gen-env.mjs 生成，勿手改；要改请改 supabase/.env.local 后重跑\n` +
  `VITE_SB_URL=${url}\n` +
  `VITE_SB_ANON_KEY=${s.SB_ANON_KEY}\n` +
  `VITE_DEMO_INVITE=DEMO01\n`);

console.log('.env 已生成');
console.log('  VITE_SB_URL      =', url, s.SB_PROXY_URL ? '（走反代）' : '（直连 supabase.co）');
console.log('  VITE_SB_ANON_KEY =', s.SB_ANON_KEY.slice(0, 18) + '…');
