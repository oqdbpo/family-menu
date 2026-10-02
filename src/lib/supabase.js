import { createClient } from '@supabase/supabase-js';
import { SB_URL, SB_ANON_KEY, isConfigured } from '../config';

export const backendConfigured = isConfigured;

export const sb = isConfigured
  ? createClient(SB_URL, SB_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // 关键：前端用的是 hash 路由，不关掉的话 supabase-js 会把 #/order 当成
        // auth 回调参数吃掉，导致刷新后路由跳走
        detectSessionInUrl: false,
        storageKey: 'fm-auth',
      },
      global: { headers: { 'x-client-info': 'family-menu/0.1' } },
    })
  : null;

// 每台设备第一次进来先换一个匿名身份，之后 join_family 把它登记成家庭成员
export async function ensureSession() {
  if (!sb) return { error: new Error('未配置后端地址') };
  const { data } = await sb.auth.getSession();
  if (data.session) return { session: data.session };
  const r = await sb.auth.signInAnonymously();
  if (r.error) return { error: r.error };
  return { session: r.data.session };
}

// 拼 Storage 公开 URL。走反代时这里跟着 SB_URL 变，不用另外配
export function publicImageUrl(path) {
  if (!path) return '';
  if (/^https?:/i.test(path)) return path;
  return `${SB_URL}/storage/v1/object/public/dish-images/${path}`;
}
