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

// 成员管理页用：把「有没有绑设备 / 是不是我自己 / 名下多少偏好和多少顿」一次拿回，
// 这样删除确认里能如实写出代价，而不是等删完才告诉用户偏好没了
export async function memberOverview() {
  const { data, error } = await sb.rpc('member_overview');
  if (error) throw error;
  return data || [];
}

// 守卫全在数据库里（0004/0005）：不能删自己、不能删现任管理员、只能删本家庭的人。
// 这里不预判，否则离线/缓存不一致时前端会给出假的安全感
export async function removeMember(id) {
  const { data, error } = await sb.rpc('remove_member', { p_member: id });
  if (error) throw error;
  return data;
}

// 只有现任管理员能交，且只能交给绑了设备的成员（0005）
export async function transferOwner(id) {
  const { data, error } = await sb.rpc('transfer_owner', { p_member: id });
  if (error) throw error;
  return data;
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
