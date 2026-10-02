// Supabase 反向代理。存在的唯一理由：境内直连 *.supabase.co 会被 SNI reset（实测 21/21 次），
// 但境内直连 Cloudflare 边缘是通的。于是浏览器只访问自家域名，由 CF 边缘去连 Supabase。
//
// 这个 Worker 刻意做薄：白名单转发 + 补 CORS + 传真实客户端 IP + 给公开图片加边缘缓存。
// 不含任何密钥。anon key 本来就在前端包里，RLS 才是真正的边界。

// 顺序敏感：越具体的前缀排越前（find 命中即停）。
const ROUTES = [
  // 唯一允许边缘缓存的一档：公开菜品图。免费额度只有 5GB/月出网，
  // 缓存在 CF 边缘之后同一张图全网只回源一次
  { prefix: '/storage/v1/object/public/', cacheTtl: 60 * 60 * 24 },
  { prefix: '/rest/v1/',    cacheTtl: 0 },   // PostgREST：读写 + RPC
  { prefix: '/auth/v1/',    cacheTtl: 0 },   // GoTrue：匿名登录、刷新令牌
  { prefix: '/storage/v1/', cacheTtl: 0 },   // 上传、签名 URL（带凭据，禁止缓存）
];

const DROP_REQUEST = new Set([
  'host', 'connection', 'keep-alive', 'upgrade', 'te', 'trailer',
  'transfer-encoding', 'proxy-authorization',
  // 这些是 CF 注入的，原样传给上游会让 Supabase 的日志/限流把 CF 节点当客户端
  'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor', 'cdn-loop',
  // 自己重建，不接受客户端伪造
  'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip',
  // 保留会让上游按压缩前的长度截断请求体；丢了自动走 chunked，PostgREST/GoTrue 都收
  'content-length', 'content-encoding',
]);

const DROP_RESPONSE = [
  'access-control-allow-origin', 'access-control-allow-methods',
  'access-control-allow-headers', 'access-control-allow-credentials',
  'access-control-expose-headers', 'access-control-max-age',
  'report-to', 'nel',
];

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('origin') || '';

    // 预检不必回源，省一次跨境往返
    if (req.method === 'OPTIONS') {
      return corsHeaders(new Response(null, { status: 204 }), origin, env, {
        'access-control-allow-methods': 'GET,HEAD,POST,PATCH,PUT,DELETE,OPTIONS',
        'access-control-allow-headers': req.headers.get('access-control-request-headers')
          || 'apikey,authorization,content-type,x-client-info,x-supabase-accept-lang,prefer',
        'access-control-max-age': '7200',
      });
    }

    // 探活：买完域名第一件事就是打这个，确认 CF 已接管且域名境内可达
    if (url.pathname === '/' || url.pathname === '/healthz') return health(env);

    const route = ROUTES.find(r => url.pathname.startsWith(r.prefix));
    if (!route) {
      return json({ error: 'path_not_proxied', pathname: url.pathname,
                    hint: `只转发 ${ROUTES.map(r => r.prefix).join(' ')}` }, 404, origin, env);
    }

    const ref = env.SUPABASE_PROJECT_REF;
    if (!ref) return json({ error: 'misconfigured', hint: '缺 SUPABASE_PROJECT_REF' }, 500, origin, env);

    const upstream = `https://${ref}.supabase.co${url.pathname}${url.search}`;
    const cacheable = route.cacheTtl > 0 && ['GET', 'HEAD'].includes(req.method);

    let res;
    try {
      res = await fetch(upstream, {
        method: req.method,
        headers: forwardRequestHeaders(req),
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body,
        redirect: 'manual',
        cf: cacheable ? { cacheTtl: route.cacheTtl } : undefined,
      });
    } catch (e) {
      // 回源失败（上游被暂停 / CF 到东京这一段抖动）必须让前端分辨得出来
      return json({ error: 'upstream_unreachable', detail: String(e && e.message || e),
                    upstream }, 502, origin, env);
    }

    const out = new Response(res.body, res);
    for (const h of DROP_RESPONSE) out.headers.delete(h);

    // 命中缓存与否写进响应头，排查"图片为什么没更新"时只看这一行就够
    if (cacheable) {
      out.headers.set('x-proxy-cache', 'edge');
      out.headers.set('cache-control', `public, max-age=${route.cacheTtl}, s-maxage=${route.cacheTtl}`);
    }

    return corsHeaders(out, origin, env);
  },
};

function forwardRequestHeaders(req) {
  const h = new Headers(req.headers);
  for (const k of DROP_REQUEST) h.delete(k);

  // 上游要看的是真客户端 IP：GoTrue 用它记 last_sign_in、Supabase 用它限流。
  // 不覆盖的话所有家人都会被算成同一个 CF 节点 IP，容易撞限流
  const ip = req.headers.get('cf-connecting-ip');
  if (ip) h.set('x-forwarded-for', ip);
  return h;
}

function corsHeaders(res, origin, env, extra = {}) {
  const allow = (env.ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const open = allow.length === 0;

  // 没配 ALLOWED_ORIGINS 就反射任意来源（点餐系统本来就靠 anon key + RLS 把关，
  // 这里不指望 CORS 当安全边界，只是防顺手蹭）。配了就必须命中白名单才发头
  if (open || (origin && allow.includes(origin))) {
    res.headers.set('access-control-allow-origin', origin || '*');
    if (origin) res.headers.set('vary', 'Origin');
    for (const [k, v] of Object.entries(extra)) res.headers.set(k, v);
  }
  // 刻意不发 access-control-allow-credentials：supabase-js 走 Authorization 头，
  // 反射任意来源 + allow-credentials 同时存在是真正的漏洞
  res.headers.set('x-proxy', 'family-menu-supabase-proxy/1');
  return res;
}

function health(env) {
  const ref = env.SUPABASE_PROJECT_REF;
  const body =
    `家庭点餐系统 · Supabase 反代\n` +
    `proxy    ok\n` +
    `upstream ${ref ? `https://${ref}.supabase.co` : '(未配置 SUPABASE_PROJECT_REF)'}\n` +
    `paths    ${ROUTES.map(r => r.prefix).join('  ')}\n` +
    `时间     ${new Date().toISOString()}\n`;
  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-proxy': 'family-menu-supabase-proxy/1',
    },
  });
}

function json(obj, status, origin, env) {
  const res = new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
  return corsHeaders(res, origin, env);
}
