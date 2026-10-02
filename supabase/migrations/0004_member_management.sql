-- =============================================================================
-- 0004 · 家庭成员管理（概览 + 移除）
--
-- 权限模型按已确认的决定实现：**任何成员都能移除别人，但不能移除自己**。
-- 不开宽松的 delete 策略——family_members 上原本只有 mem_read / mem_self，
-- 一旦加 "for delete using (family_id = current_family_id())"，任何人就能绕过
-- "不能删自己" 直接用 REST 删任意行。所以校验全部写在函数里，函数用定义者权限。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 概览：一次查询带回「有没有绑设备 / 是不是我自己 / 名下多少偏好、多少顿」
--    刻意保持默认的 security invoker：读路径必须继续受 RLS 约束。
--    成员行的读策略是 mem_read（本家庭），偏好的是 pref_read、订单的是 mo_all，
--    三者都已按 current_family_id() 隔离，所以这里不需要任何越权动作。
-- -----------------------------------------------------------------------------
create or replace function member_overview()
returns table (id uuid, name text, role text, bound boolean, is_self boolean,
               prefs int, orders int, joined timestamptz)
language sql stable set search_path = public as $$
  select m.id, m.name, m.role,
         m.auth_uid is not null,
         coalesce(m.auth_uid = auth.uid(), false),
         (select count(*)::int from member_dish_preferences p where p.member_id = m.id),
         (select count(*)::int from meal_orders o where o.created_by = m.id),
         m.created_at
    from family_members m
   where m.family_id = public.current_family_id()
   order by m.created_at
$$;

-- -----------------------------------------------------------------------------
-- 2. 移除成员
--    没有加「至少留一个人」的判断，因为那是条不可达的分支：
--    能调这个函数的人本身就是成员，删掉自己又被挡住，所以家里的行数永远 ≥ 1。
--    删完之后 TA 独自在家，也删不动任何人（只剩自己），流程自然终止。
--
--    连带效应（UI 必须提前讲清楚，别让人事后才发现）：
--      member_dish_preferences  on delete cascade —— TA 投的票真的没了，
--                               随机算法里「全家平均」那一项的权重会变；
--      meal_orders.created_by   on delete set null —— 历史订单保留，
--                               只是不再显示是谁点的。
-- -----------------------------------------------------------------------------
create or replace function remove_member(p_member uuid) returns text
language plpgsql security definer set search_path = public as $$
declare fam uuid; m record;
begin
  if auth.uid() is null then
    raise exception '请先完成匿名登录' using errcode = '42501';
  end if;

  fam := public.current_family_id();
  if fam is null then
    raise exception '这台设备还没加入任何家庭' using errcode = '42501';
  end if;

  -- 目标必须落在自己家里；拿别的家庭的 uuid 来也查不到，天然防越权
  select * into m from family_members
    where id = p_member and family_id = fam;
  if not found then
    raise exception '家里没有这名成员' using errcode = 'P0002';
  end if;

  if m.auth_uid = auth.uid() then
    raise exception '不能删掉自己。想离开这个家，让家人帮你移除' using errcode = 'P0001';
  end if;

  delete from family_members where id = p_member;
  return m.name;
end $$;

grant execute on function member_overview()     to anon, authenticated;
grant execute on function remove_member(uuid)   to anon, authenticated;

-- 新建函数后必须让 PostgREST 重载 schema 缓存，否则 /rest/v1/rpc/* 返回
-- 404 "requested path is invalid"（0001 踩过）
notify pgrst, 'reload schema';
