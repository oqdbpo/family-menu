// =============================================================================
// 本地隧道：给"不走系统代理"的浏览器开一条到 Supabase 的路
//
// 为什么需要：这台机器上 *.supabase.co 被 SNI reset（README §31.1），日常靠系统代理
// 127.0.0.1:7897 绕开。但内置预览面板那类浏览器不吃系统代理，于是本地 dev 打开就是
// 「正在叫醒厨房」，任何要连库的界面都没法真人点一遍。这里把
//   http://127.0.0.1:8790/**  搬到  SB_URL/**
// 让 dev 服务器用真数据跑起来，验收完直接停掉，不进生产链路。
//
//   终端 1：node tools/dev-tunnel.mjs
//   终端 2：VITE_SB_URL=http://127.0.0.1:8790 npx vite
//   浏览器： http://127.0.0.1:5173/
//
// 只用匿名会话 + 示范家庭 DEMO01。绝不指向真家庭：这个隧道会产生真实写入。
// =============================================================================

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const out = {};
  const f = path.join(HERE, '..', 'supabase', '.env.local');
  if (fs.existsSync(f)) {
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return { ...out, ...process.env };
}

const env = loadEnv();

// Node 的 global fetch 只在进程启动前就设了这个变量才读代理，所以带上它重启自己
if (env.HTTPS_PROXY && !process.env.NODE_USE_ENV_PROXY) {
  process.env.NODE_USE_ENV_PROXY = '1';
  process.env.HTTPS_PROXY = env.HTTPS_PROXY;
  process.env.HTTP_PROXY = env.HTTP_PROXY || env.HTTPS_PROXY;
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)],
                      { stdio: 'inherit', env: process.env });
  process.exit(r.status ?? 1);
}

const SB = (env.SB_URL || '').replace(/\/+$/, '');
if (!SB) {
  console.error('缺 SB_URL，supabase/.env.local 里没找到');
  process.exit(1);
}
const PORT = Number(process.argv[2] || 8790);

// 逐跳头 + 会随解压失效的长度/编码都不能原样带过去；accept-encoding 一律不发，
// 让 undici 自己解压，我们只回传明文，省掉"转发了 gzip 但 content-length 对不上"这类坑
const DROP = new Set(['host', 'connection', 'keep-alive', 'upgrade', 'te', 'trailer',
  'transfer-encoding', 'content-length', 'content-encoding', 'accept-encoding']);

const CORS_BASE = {
  'access-control-allow-methods': 'GET,HEAD,POST,PATCH,PUT,DELETE,OPTIONS',
  'access-control-max-age': '600',
};
// 兜底清单。真正的放行看下面的回显——supabase-js 2.117 会发 x-supabase-api-version，
// 写死清单迟早漏掉一个新头（本地就是这样被 CORS 卡住的）
const CORS_FALLBACK = 'apikey,authorization,content-type,x-client-info,prefer,'
  + 'content-profile,accept-profile,x-supabase-accept-lang,x-supabase-api-version,x-apispec-version';

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : null;
  const noBody = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!DROP.has(k)) headers[k] = v;

  let up;
  try {
    up = await fetch(SB + req.url, {
      method: req.method,
      headers,
      body: noBody ? undefined : body,
      redirect: 'manual',
    });
  } catch (e) {
    res.writeHead(502, {
      'content-type': 'text/plain; charset=utf-8',
      'access-control-allow-origin': req.headers.origin || '*',
      'access-control-allow-headers': CORS_FALLBACK,
      ...CORS_BASE,
    });
    res.end(`dev-tunnel 回源失败：${e.message}`);
    return;
  }

  const buf = Buffer.from(await up.arrayBuffer());
  const out = {};
  for (const [k, v] of up.headers) {
    if (DROP.has(k) || k === 'access-control-allow-origin') continue;
    out[k] = v;
  }
  // 上游那份 CORS 头已经剥掉，这里只发一份，来源按当前页面回显。
  // allow-headers 直接回显预检带来的清单，新头加进来也不用改这里
  out['access-control-allow-origin'] = req.headers.origin || '*';
  out['access-control-allow-headers'] =
    req.headers['access-control-request-headers'] || CORS_FALLBACK;
  Object.assign(out, CORS_BASE);
  out['content-length'] = buf.length;
  out['x-dev-tunnel'] = SB;

  res.writeHead(up.status, out);
  res.end(req.method === 'OPTIONS' ? undefined : buf);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\ndev-tunnel  http://127.0.0.1:${PORT}  →  ${SB}`);
  console.log('接着跑：VITE_SB_URL=http://127.0.0.1:%d npx vite\n', PORT);
});
