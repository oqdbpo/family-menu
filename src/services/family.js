import { sb } from '../lib/supabase';
import { ensureSession } from '../lib/supabase';
import { submit } from '../lib/db';

export { ensureSession };

// RLS 只放行本家庭的 family 行，所以这条查询返回 0 行 = 这台设备还没加入任何家庭
export async function myFamily() {
  const { data, error } = await sb.from('families').select('id,name,invite_code').limit(1);
  if (error) throw error;
  return data[0] || null;
}

export async function listMembers() {
  const { data, error } = await sb.from('family_members')
    .select('id,name,avatar,role,created_at').order('created_at');
  if (error) throw error;
  return data;
}

export async function createFamily(name, myName) {
  const { data, error } = await sb.rpc('create_family', { p_name: name, p_owner_name: myName });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  await ensureSession();
  return row;
}

export async function joinFamily(code, myName) {
  const { data, error } = await sb.rpc('join_family', { p_code: code, p_name: myName });
  if (error) throw error;
  return data;
}

export async function renameSelf(name) {
  const { error } = await sb.rpc('rename_self', { p_name: name });
  if (error) throw error;
}

// 偏好投票：饭桌上最常发生、也最该在断网时还能点
export async function vote(dishId, pref) {
  const me = await currentMemberId();
  if (!me) throw new Error('还没加入家庭');
  return submit({
    type: 'upsert', table: 'member_dish_preferences',
    row: { member_id: me, dish_id: dishId, pref }, onConflict: 'member_id,dish_id',
  }, { label: '投票' });
}

let memberCache = null;
export async function currentMemberId() {
  if (memberCache) return memberCache;
  const { data, error } = await sb.auth.getUser();
  if (error) throw error;
  const { data: rows } = await sb.from('family_members').select('id').eq('auth_uid', data.user.id).limit(1);
  memberCache = rows?.[0]?.id || null;
  return memberCache;
}
export function resetMemberCache() { memberCache = null; }
