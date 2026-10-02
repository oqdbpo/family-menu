// 反代逻辑自测。Workers 的 fetch/Request/Response/Headers 在 Node 24 里都有，
// 所以能把 index.js 直接当模块跑，只把回源那一下换成假响应。
// 用法：node worker/selftest.mjs
import proxy from './src/index.js';

const ENV = {
  SUPABASE_PROJECT_REF: 'myawyxhhllvsdpqabnro',
  ALLOWED_ORIGINS: 'https://oqdbpo.github.io,http://localhost:5173',
};

const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url, init });
  return new Response(JSON.stringify({ id: 'fake', upstream: url }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      // 上游自带 CORS 头，必须被剥掉，否则两份 allow-origin 浏览器直接判非法
      'access-control-allow-origin': 'https://oqdbpo.github.io',
      'access-control-allow-credentials': 'true',
    },
  });
};

let fails = 0;
function ok(name, cond, detail = '') {
  console.log(`${cond ? '✓' : '✗'} ${name}${cond ? '' : `  ← ${detail}`}`);
  if (!cond) fails++;
}

function req(path, { method = 'GET', origin = 'https://oqdbpo.github.io', headers = {} } = {}) {
  const h = { 'apikey': 'sb_publishable_xxx', 'x-forwarded-for': '1.2.3.4', ...headers };
  if (origin) h.origin = origin;
  return new Request(`https://menu.example.com${path}`, { method, headers: h });
}

// 1. 健康检查
const h = await proxy.fetch(req('/'), ENV);
const ht = await h.text();
ok('GET / 返回 200 且列出上游全名', h.status === 200 && ht.includes('https://myawyxhhllvsdpqabnro.supabase.co'), ht);

// 2. 白名单前缀
calls.length = 0;
for (const p of ['/rest/v1/dishes?select=id', '/auth/v1/token?grant_type=anonymous',
                 '/storage/v1/object/public/dish-images/f1/a.webp', '/storage/v1/object/f1/b.webp']) {
  await proxy.fetch(req(p), ENV);
}
ok('4 条业务路径都转发到 supabase.co',
  calls.length === 4 && calls.every(c => c.url.startsWith('https://myawyxhhllvsdpqabnro.supabase.co')),
  JSON.stringify(calls.map(c => c.url)));
ok('query string 原样保留', calls[0].url.endsWith('/rest/v1/dishes?select=id'), calls[0].url);
ok('公开图走 /object/public/，签名上传走 /object/', calls[2].url.includes('/object/public/'));

// 3. 非白名单路径不回源
calls.length = 0;
const denied = await proxy.fetch(req('/rest/v2/x'), ENV);
ok('陌生路径 404 且不回源', denied.status === 404 && calls.length === 0);

// 4. 请求头：删掉伪造的 x-forwarded-for，用 CF 给的客户端 IP 重建
await proxy.fetch(new Request('https://menu.example.com/rest/v1/dishes', {
  headers: { 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '8.8.8.8',
             'host': 'menu.example.com', 'apikey': 'sb_publishable_xxx',
             'content-encoding': 'gzip', 'content-length': '9999' },
}), ENV);
const fh = calls[calls.length - 1].init.headers;
ok('x-forwarded-for 被真实客户端 IP 覆盖', fh.get('x-forwarded-for') === '203.0.113.9', fh.get('x-forwarded-for'));
ok('host 头不传给上游', fh.get('host') === null);
ok('content-length/encoding 不传给上游', fh.get('content-length') === null && fh.get('content-encoding') === null);
ok('apikey 仍然传下去', fh.get('apikey') === 'sb_publishable_xxx');

// 5. 上游 CORS 头被剥掉，credentials 不放开
const r5 = await proxy.fetch(req('/rest/v1/dishes?select=*'), ENV);
ok('allow-origin 只有一份', r5.headers.get('access-control-allow-origin') === 'https://oqdbpo.github.io');
ok('不透传 allow-credentials', r5.headers.get('access-control-allow-credentials') === null);
ok('上游 json 主体原样透传', (await r5.json()).id === 'fake');

// 6. 白名单外的来源拿不到 CORS 头
const r6 = await proxy.fetch(req('/rest/v1/dishes', { origin: 'https://evil.example' }), ENV);
ok('陌生 origin 不发 allow-origin', r6.headers.get('access-control-allow-origin') === null);

// 7. 预检本地应答，不回源
calls.length = 0;
const pre = await proxy.fetch(new Request('https://menu.example.com/rest/v1/dishes', {
  method: 'OPTIONS',
  headers: { origin: 'https://oqdbpo.github.io',
             'access-control-request-headers': 'apikey,authorization,content-type,prefer' },
}), ENV);
ok('OPTIONS 204 且不回源', pre.status === 204 && calls.length === 0);
ok('预检回显请求头', pre.headers.get('access-control-allow-headers') === 'apikey,authorization,content-type,prefer');
ok('预检 methods 齐', /PATCH/.test(pre.headers.get('access-control-allow-methods')));

// 8. 只有公开图加边缘缓存
await proxy.fetch(req('/storage/v1/object/public/dish-images/f1/a.webp'), ENV);
await proxy.fetch(req('/rest/v1/dishes'), ENV);
const imgCf = calls[calls.length - 2].init.cf;
const apiCf = calls[calls.length - 1].init.cf;
ok('公开图 cacheTtl=86400', imgCf && imgCf.cacheTtl === 86400, JSON.stringify(imgCf));
ok('接口不缓存', apiCf === undefined, JSON.stringify(apiCf));

// 9. POST 带 body、DELETE 方法都原样转发
await proxy.fetch(req('/rest/v1/rpc/confirm_order', { method: 'POST' }), ENV);
const p = calls[calls.length - 1].init;
ok('POST 方法传递', p.method === 'POST' && p.body !== undefined);
ok('redirect:manual', p.redirect === 'manual');

// 10. 回源炸了要给 502 + 可读原因，而不是让前端看到 undefined
globalThis.fetch = async () => { throw new Error('SNI reset'); };
const bad = await proxy.fetch(req('/rest/v1/dishes'), ENV);
ok('回源失败 502', bad.status === 502);
ok('502 里写清原因', (await bad.json()).detail === 'SNI reset');

// 11. 漏配 ref 时不要静默 404
const noRef = await proxy.fetch(req('/rest/v1/dishes'), { ALLOWED_ORIGINS: '' });
ok('缺 SUPABASE_PROJECT_REF 报 500', noRef.status === 500);

console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
process.exit(fails ? 1 : 0);
