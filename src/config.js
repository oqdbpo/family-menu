// 运行时配置。将来上反代域名时，只改 .env 里的 VITE_SB_URL 即可，代码零改动。
export const SB_URL = import.meta.env.VITE_SB_URL || '';
export const SB_ANON_KEY = import.meta.env.VITE_SB_ANON_KEY || '';
export const DEMO_INVITE = import.meta.env.VITE_DEMO_INVITE || '';

export const isConfigured = Boolean(SB_URL && SB_ANON_KEY);

// 把 supabase-js / fetch 抛出的各种失败归成前端能画的四种态
export function classifyError(err) {
  const msg = String(err?.message || err || '');
  if (/Failed to fetch|NetworkError|timeout|ECONN|ERR_/i.test(msg)) return 'offline';
  if (/JWT expired|invalid claim|AuthApiError|not logged in/i.test(msg)) return 'auth';
  if (/row-level security|42501|forbidden/i.test(msg)) return 'forbidden';
  if (/邀请码/i.test(msg)) return 'invite';
  return 'error';
}
