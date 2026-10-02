-- =============================================================================
-- 0005 · 管理员的归属只有一个来源，移除管理员要先移交
--
-- 为什么要改：0004 之后"任何成员都能移除别人"，而 families 的更新策略是
--   using (id = current_family_id() and owner_uid = auth.uid())
-- —— 只有 owner_uid 那一台能改家庭名字。把 TA 移除掉、TA 又不重新填码进来，
--   这个家就再没人改得了名字。所以移除管理员必须先把管理员交出去。
--
-- 顺手纠正一件事：**「管理员」这件事有两个来源**——families.owner_uid（权威，
-- 策略真正读它）和 family_members.role='owner'（create_family 顺手写的标签）。
-- 示范家庭里这俩是矛盾的：owner_uid 是种子占位 0000…（对应不上任何成员），
-- 而那个假的「爸爸」成员行 role='owner'。之前 UI 显示的是 role，
-- 于是徽章说"管理员"、规则却不管——两处不一致迟早让人误判。
-- 现在徽章和守卫都只看 owner_uid 一处。
-- =============================================================================

-- 1. 概览改成带 is_owner（以 owner_uid 为准），role 仍然一并回传但不再用来画徽章
drop function if exists member_overview();
create or replace function member_overview()
returns table (id uuid, name text, role text, bound boolean, is_self boolean,
               is_owner boolean, prefs int, orders int, joined timestamptz)
language sql stable set search_path = public as $$
  select m.id, m.name, m.role,
         m.auth_uid is not null,
         coalesce(m.auth_uid = auth.uid(), false),
         -- owner_uid 是占位值时谁都匹配不上，is_owner 全 false —— 这是对的：
         -- 示范家庭本来就没有能改名字的人
         coalesce(m.auth_uid = f.owner_uid, false),
         (select count(*)::int from member_dish_preferences p where p.member_id = m.id),
         (select count(*)::int from meal_orders o where o.created_by = m.id),
         m.created_at
    from family_members m
    join families f on f.id = m.family_id
   where m.family_id = public.current_family_id()
   order by m.created_at
$$;

-- 2. 移交管理员。只有现任 owner 能交，交给本家庭一台已绑定的设备。
--    owner_uid 和 role 两个来源在这里一次写齐，不留矛盾状态。
create or replace function transfer_owner(p_member uuid) returns text
language plpgsql security definer set search_path = public as $$
declare fam uuid; boss uuid; m record;
begin
  if auth.uid() is null then
    raise exception '请先完成匿名登录' using errcode = '42501';
  end if;

  fam := public.current_family_id();
  if fam is null then
    raise exception '这台设备还没加入任何家庭' using errcode = '42501';
  end if;

  select owner_uid into boss from families where id = fam;
  if boss is distinct from auth.uid() then
    raise exception '只有现任管理员能把管理员交给别人' using errcode = '42501';
  end if;

  select * into m from family_members where id = p_member and family_id = fam;
  if not found then
    raise exception '家里没有这名成员' using errcode = 'P0002';
  end if;
  -- 没绑设备的成员当不了管理员：owner_uid 要能对上一个真实登录
  if m.auth_uid is null then
    raise exception '这个成员没有绑定设备，当不了管理员' using errcode = 'P0001';
  end if;

  update families set owner_uid = m.auth_uid where id = fam;
  update family_members set role = 'member' where family_id = fam and role = 'owner';
  update family_members set role = 'owner'  where id = p_member;
  return m.name;
end $$;

-- 3. 给 remove_member 补上那道守卫（函数体其余部分与 0004 一致）
create or replace function remove_member(p_member uuid) returns text
language plpgsql security definer set search_path = public as $$
declare fam uuid; boss uuid; m record;
begin
  if auth.uid() is null then
    raise exception '请先完成匿名登录' using errcode = '42501';
  end if;

  fam := public.current_family_id();
  if fam is null then
    raise exception '这台设备还没加入任何家庭' using errcode = '42501';
  end if;

  select * into m from family_members where id = p_member and family_id = fam;
  if not found then
    raise exception '家里没有这名成员' using errcode = 'P0002';
  end if;

  if m.auth_uid = auth.uid() then
    raise exception '不能删掉自己。想离开这个家，让家人帮你移除' using errcode = 'P0001';
  end if;

  select owner_uid into boss from families where id = fam;
  if m.auth_uid = boss then
    raise exception 'TA 是这个家的管理员。先把管理员交给别人，再来移除' using errcode = 'P0001';
  end if;

  delete from family_members where id = p_member;
  return m.name;
end $$;

grant execute on function member_overview()      to anon, authenticated;
grant execute on function transfer_owner(uuid)   to anon, authenticated;
grant execute on function remove_member(uuid)    to anon, authenticated;

notify pgrst, 'reload schema';
