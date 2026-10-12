-- =============================================================================
-- 0009 · 名字即身份：换设备不再是"新成员"
--
-- 病灶：身份原本是"浏览器 localStorage 里那个匿名 uuid"。换手机、换浏览器、清过数据、
-- 开无痕 = 新 uuid = join_family 插一条**新成员行**；而 families.owner_uid 又绑在 uuid 上，
-- 于是管理员随设备漂移（实测踩过：同一个「妈妈」在 10-02 和 10-12 长出两行）。
-- 现在把"人"和"设备"分层：
--   family_members 那一行 = 人（偏好、订单、role 都挂在行上）
--   auth_uid             = 此刻哪台设备在代表这个人（可以换，换了数据不跟着换）
--
-- 明确接受的代价（选 C 的交换条件，别再当 bug 复查）：
--   任何知道邀请码的人都能认领任意成员身份，包括管理员那一行 —— 能改家庭名、能移除成员。
--   挡住外人靠的是"邀请码不外泄"这一条，数据库不设第二道门。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 一个家里名字唯一：这是"认领"能成立的前提，也顺手堵死重复成员行
--    小写比较，避免「妈妈 」/「妈妈」/大小写差异各算一个人
--    上线前实测过现存数据无重名，所以这个索引能建起来
-- -----------------------------------------------------------------------------
create unique index if not exists member_name_uniq
  on family_members (family_id, lower(name));

-- owner_uid 从此不再被任何策略/函数读取，降级为历史遗留列。
-- 刻意留着不删（可回退），但改成可空并停止写入——留着当"看起来权威却没人维护"的列，
-- 迟早又变成第二个真相源（0005 那次就是栽在有两个真相）
alter table families alter column owner_uid drop not null;

-- -----------------------------------------------------------------------------
-- 2. 改家庭名的权限跟着 role 走，不再跟设备走
--    fam_write 里子查 family_members 不会递归：mem_read 走的是
--    current_family_id()，那是 SECURITY DEFINER 函数，内部不受 RLS 约束
-- -----------------------------------------------------------------------------
drop policy if exists fam_write on families;
create policy fam_write on families for update
  using (id = public.current_family_id()
     and exists (select 1 from public.family_members m
                  where m.family_id = families.id
                    and m.auth_uid  = auth.uid()
                    and m.role      = 'owner'));

-- -----------------------------------------------------------------------------
-- 3. 认领式加入：有同名成员就把这台设备接上去，没有才新建
-- -----------------------------------------------------------------------------
drop function if exists join_family(text, text);
create or replace function join_family(p_code text, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare fam uuid; mem uuid; want text;
begin
  if auth.uid() is null then
    raise exception '请先完成匿名登录' using errcode = '42501';
  end if;

  select families.id into fam from families
    where families.invite_code = upper(trim(coalesce(p_code, '')));
  if fam is null then
    raise exception '邀请码不对，请跟家人确认一下' using errcode = 'P0002';
  end if;

  want := coalesce(nullif(trim(p_name), ''), '新成员');

  -- 一台设备同一时刻只能代表一个人。先把这个 uid 从别的名字上解绑，
  -- 否则妈妈改成爸爸时 auth_uid 的唯一约束会撞
  update family_members set auth_uid = null where auth_uid = auth.uid();

  select m.id into mem from family_members m
    where m.family_id = fam and lower(m.name) = lower(want);

  if mem is not null then
    -- 认领：把这台设备接到已有的人身上。原来那台设备会掉回加入页（设计如此），
    -- 它重新点一次同一个名字就回来了，数据一行不动
    update family_members set auth_uid = auth.uid() where id = mem;
    return mem;
  end if;

  -- 新名字：建一条。永远建不出 owner —— owner 只能由 create_family 或 transfer_owner 产生，
  -- 否则"知道邀请码 + 起个新名字"就能造一个管理员
  insert into family_members (family_id, auth_uid, name)
    values (fam, auth.uid(), want)
    returning family_members.id into mem;
  return mem;
end $$;

-- -----------------------------------------------------------------------------
-- 4. 改名同样不能撞别人的名字，撞了要说人话（ postgres 的 23505 原文没人看得懂）
-- -----------------------------------------------------------------------------
create or replace function rename_self(p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare fam uuid; want text; hit uuid;
begin
  fam := public.current_family_id();
  if fam is null then
    raise exception '这台设备还没加入任何家庭' using errcode = '42501';
  end if;
  want := nullif(trim(p_name), '');
  if want is null then return; end if;

  select m.id into hit from family_members m
    where m.family_id = fam and lower(m.name) = lower(want)
      and (m.auth_uid is distinct from auth.uid());
  if hit is not null then
    raise exception '家里已经有叫「%」的人了，换个称呼或让 TA 改名', want using errcode = '23505';
  end if;

  update family_members set name = want where auth_uid = auth.uid();
end $$;

-- -----------------------------------------------------------------------------
-- 5. 概览和管理员守卫都改读 role（签名不变，所以 create or replace 就够）
-- -----------------------------------------------------------------------------
create or replace function member_overview()
returns table (id uuid, name text, role text, bound boolean, is_self boolean,
               is_owner boolean, prefs int, orders int, joined timestamptz)
language sql stable set search_path = public as $$
  select m.id, m.name, m.role,
         m.auth_uid is not null,
         coalesce(m.auth_uid = auth.uid(), false),
         m.role = 'owner',
         (select count(*)::int from member_dish_preferences p where p.member_id = m.id),
         (select count(*)::int from meal_orders o where o.created_by = m.id),
         m.created_at
    from family_members m
   where m.family_id = public.current_family_id()
   order by m.created_at
$$;

-- 移交管理员：只写 role，一次写齐不留中间态；口令/授权都不涉及
create or replace function transfer_owner(p_member uuid) returns text
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

  if not exists (select 1 from family_members
                  where family_id = fam and auth_uid = auth.uid() and role = 'owner') then
    raise exception '只有现任管理员能把管理员交给别人' using errcode = '42501';
  end if;

  select * into m from family_members where id = p_member and family_id = fam;
  if not found then
    raise exception '家里没有这名成员' using errcode = 'P0002';
  end if;
  if m.auth_uid is null then
    raise exception '这个成员没有绑定设备，当不了管理员' using errcode = 'P0001';
  end if;

  update family_members set role = 'member' where family_id = fam and role = 'owner';
  update family_members set role = 'owner'   where id = p_member;
  return m.name;
end $$;

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

  select * into m from family_members where id = p_member and family_id = fam;
  if not found then
    raise exception '家里没有这名成员' using errcode = 'P0002';
  end if;
  if m.auth_uid = auth.uid() then
    raise exception '不能删掉自己。想离开这个家，让家人帮你移除' using errcode = 'P0001';
  end if;
  if m.role = 'owner' then
    raise exception 'TA 是这个家的管理员。先把管理员交给别人，再来移除' using errcode = 'P0001';
  end if;

  delete from family_members where id = p_member;
  return m.name;
end $$;

-- -----------------------------------------------------------------------------
-- 6. 加入页的"点自己是谁"名单：码对才给名单
--    故意不做成"任何人可查"——它是 security definer，靠邀请码把关；
--    码错就返回空，不区分"码错"和"这家没人"，免得被拿来枚举哪些码有效
-- -----------------------------------------------------------------------------
create or replace function family_roster(p_code text)
returns table (name text, is_owner boolean, bound boolean)
language plpgsql stable security definer set search_path = public as $$
declare fam uuid;
begin
  select f.id into fam from families f
    where f.invite_code = upper(trim(coalesce(p_code, '')));
  if fam is null then return; end if;

  return query
    select m.name, m.role = 'owner', m.auth_uid is not null
      from family_members m
     where m.family_id = fam
     order by m.created_at;
end $$;

grant execute on function join_family(text, text)   to anon, authenticated;
grant execute on function rename_self(text)         to anon, authenticated;
grant execute on function member_overview()         to anon, authenticated;
grant execute on function transfer_owner(uuid)      to anon, authenticated;
grant execute on function remove_member(uuid)       to anon, authenticated;
grant execute on function family_roster(text)       to anon, authenticated;

notify pgrst, 'reload schema';
