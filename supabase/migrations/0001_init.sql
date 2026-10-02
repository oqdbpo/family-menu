-- =============================================================================
-- 家庭点餐系统 · 初始迁移
-- 目标：Supabase (PostgreSQL 15+)
-- 前置：在 Supabase Dashboard 开启 Authentication → Providers → Anonymous sign-ins
--
-- 身份模型（对应 README 第 20–21 节「第一阶段不需要复杂账号体系」）：
--   每台设备匿名登录 → 得到一个 auth.uid() → 用「邀请码」join_family →
--   该 uid 被登记为 family_members 的一行。爸爸/妈妈/孩子各一台设备，天然就是三个成员。
--   所有表的隔离都走 current_family_id()，RLS 在数据库层强制，不依赖前端判断。
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. 全局字典（所有家庭共用，对应 README 第 33.2 节「数据驱动 UI，不写死在前端」）
--    注意：这里刻意不放 family_id —— 第一阶段没有「各家自定义食材」的需求，
--    将来要加时再补一列并放宽唯一约束即可。
-- -----------------------------------------------------------------------------
create table ingredients (
  id   serial primary key,
  name text not null unique,
  kind text not null default '其他'   -- 肉类 / 水产 / 蛋类 / 豆制品 / 蔬菜 / 菌菇 / 主食 / 其他
);

create table cooking_methods (
  id   serial primary key,
  name text not null unique
);

create table tags (
  id   serial primary key,
  name text not null unique,
  kind text not null default '特点'   -- 口味 / 特点 / 人群 / 季节
);

-- 两级分类：正餐用 category；火锅的 8 个细分放在 subcategory
create table category_dict (
  id          serial primary key,
  meal_type   text not null check (meal_type in ('早餐','正餐')),
  category    text not null,
  subcategory text not null default '',
  sort        int  not null default 0,
  unique (meal_type, category, subcategory)
);

-- 「随机一桌」的配菜规则，可随家庭习惯调整（README 第 12.3 节）
create table table_plan (
  id          serial primary key,
  meal_type   text not null default '正餐',
  min_people  int  not null default 1,
  max_people  int  not null default 99,
  category    text not null,
  subcategory text not null default '',
  qty         int  not null default 1,
  sort        int  not null default 0
);

-- -----------------------------------------------------------------------------
-- 2. 家庭与成员
-- -----------------------------------------------------------------------------
create table families (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_uid   uuid not null,
  invite_code text not null unique
              default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6)),
  created_at  timestamptz not null default now()
);

create table family_members (
  id        uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  auth_uid  uuid unique references auth.users(id) on delete cascade,
  name      text not null,
  avatar    text,
  role      text not null default 'member' check (role in ('owner','member')),
  created_at timestamptz not null default now()
);
create index on family_members (family_id);

-- -----------------------------------------------------------------------------
-- 3. 菜品（README 第 15 节 + 第 28 节四原则）
--    分类(category) 与 食材(ingredient_id) 是两个独立概念 —— 西红柿炒鸡蛋
--    归「素菜」，食材仍记「鸡蛋」。
-- -----------------------------------------------------------------------------
create table dishes (
  id                uuid primary key default gen_random_uuid(),
  family_id         uuid not null references families(id) on delete cascade,
  name              text not null,
  meal_type         text not null check (meal_type in ('早餐','正餐')),
  category          text not null,
  subcategory       text not null default '',
  ingredient_id     int  references ingredients(id),
  cooking_method_id int  references cooking_methods(id),
  description       text,
  image_path        text,                 -- Storage 对象路径，公开 URL 由前端拼
  spicy_level       int  not null default 0 check (spicy_level between 0 and 5),
  difficulty        int  not null default 1 check (difficulty between 1 and 5),
  cooking_time      int  not null default 15 check (cooking_time between 1 and 600),
  is_favorite       boolean not null default false,
  is_active         boolean not null default true,
  -- 下面两列是「历史数据」，与「这是什么菜」无关，只服务于随机算法（README 第 28 节原则四）
  eat_count         int  not null default 0,
  last_eaten_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (family_id, meal_type, category, name)
);
create index on dishes (family_id, meal_type, category) where is_active;
create index on dishes (family_id, ingredient_id, cooking_method_id) where is_active;
create index on dishes (family_id, last_eaten_at);

create table dish_tags (
  dish_id uuid not null references dishes(id) on delete cascade,
  tag_id  int  not null references tags(id)  on delete cascade,
  primary key (dish_id, tag_id)
);
create index on dish_tags (tag_id);

-- -----------------------------------------------------------------------------
-- 4. 成员偏好（README 第 22 节）  -1 不喜欢 / 0 一般 / 1 喜欢
-- -----------------------------------------------------------------------------
create table member_dish_preferences (
  member_id uuid not null references family_members(id) on delete cascade,
  dish_id   uuid not null references dishes(id) on delete cascade,
  pref      int  not null check (pref in (-1, 0, 1)),
  updated_at timestamptz not null default now(),
  primary key (member_id, dish_id)
);

-- -----------------------------------------------------------------------------
-- 5. 点餐记录（README 第 23–25 节）
--    一天一餐只允许一条 order，所以「今日点餐」= upsert 到 draft 那条。
-- -----------------------------------------------------------------------------
create table meal_orders (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references families(id) on delete cascade,
  meal_date  date not null,
  meal_type  text not null check (meal_type in ('早餐','午餐','晚餐','其他')),
  status     text not null default 'draft' check (status in ('draft','confirmed','done')),
  created_by uuid references family_members(id) on delete set null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unique (family_id, meal_date, meal_type)
);
create index on meal_orders (family_id, meal_date desc);

create table meal_order_items (
  id       uuid primary key default gen_random_uuid(),
  order_id uuid not null references meal_orders(id) on delete cascade,
  dish_id  uuid not null references dishes(id) on delete restrict,
  quantity int  not null default 1 check (quantity > 0),
  category text not null default '',
  created_at timestamptz not null default now(),
  unique (order_id, dish_id)
);
create index on meal_order_items (dish_id);

-- -----------------------------------------------------------------------------
-- 6. 通用触发器：updated_at
-- -----------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger trg_dishes_updated  before update on dishes              for each row execute function set_updated_at();
create trigger trg_prefs_updated   before update on member_dish_preferences for each row execute function set_updated_at();

-- -----------------------------------------------------------------------------
-- 7. 身份辅助函数
--    SECURITY DEFINER 让它以属主权限查 family_members，从而绕开 RLS 自引用死循环。
-- -----------------------------------------------------------------------------
create or replace function current_family_id() returns uuid
language sql stable security definer set search_path = public
as $$
  select family_id from family_members where auth_uid = auth.uid() limit 1
$$;

create or replace function current_member_id() returns uuid
language sql stable security definer set search_path = public
as $$
  select id from family_members where auth_uid = auth.uid() limit 1
$$;

revoke execute on function current_family_id(), current_member_id() from anon, authenticated;
grant  execute on function current_family_id(), current_member_id() to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8. 建家 / 加入（README 第 21 节「家庭邀请码 / 家庭链接」）
-- -----------------------------------------------------------------------------
create or replace function create_family(p_name text, p_owner_name text)
returns table (family_id uuid, member_id uuid, invite_code text)
language plpgsql security definer set search_path = public as $$
declare
  fam uuid; mem uuid; code text;
begin
  if auth.uid() is null then
    raise exception '请先完成匿名登录' using errcode = '42501';
  end if;
  if current_family_id() is not null then
    raise exception '这台设备已经在一个家庭里了' using errcode = '23505';
  end if;

  insert into families (name, owner_uid)
    values (coalesce(nullif(trim(p_name), ''), '我的家'), auth.uid())
    returning families.id, families.invite_code into fam, code;

  insert into family_members (family_id, auth_uid, name, role)
    values (fam, auth.uid(), coalesce(nullif(trim(p_owner_name), ''), '家长'), 'owner')
    returning family_members.id into mem;

  return query select fam, mem, code;
end $$;

create or replace function join_family(p_code text, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare fam uuid; mem uuid;
begin
  if auth.uid() is null then
    raise exception '请先完成匿名登录' using errcode = '42501';
  end if;

  select families.id into fam from families
    where families.invite_code = upper(trim(coalesce(p_code, '')));
  if fam is null then
    raise exception '邀请码不对，请跟家人确认一下' using errcode = 'P0002';
  end if;

  insert into family_members (family_id, auth_uid, name)
    values (fam, auth.uid(), coalesce(nullif(trim(p_name), ''), '新成员'))
    on conflict (auth_uid) do update
      set family_id = excluded.family_id, name = excluded.name
    returning family_members.id into mem;

  return mem;
end $$;

-- 改自己的显示名（成员只能改自己那行）
create or replace function rename_self(p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update family_members set name = coalesce(nullif(trim(p_name), ''), name)
    where auth_uid = auth.uid();
end $$;

-- -----------------------------------------------------------------------------
-- 9. 确认点餐：一次事务里翻状态 + 回写菜品统计（README 第 25 节）
--    刻意用 RPC 而不是触发器：避免「草稿期反复增删明细」把 eat_count 算脏。
--    已确认的订单不再二次计数。
-- -----------------------------------------------------------------------------
create or replace function confirm_order(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
declare fam uuid; st text;
begin
  select family_id, status into fam, st from meal_orders where id = p_order;
  if fam is null then raise exception '点餐记录不存在' using errcode = 'P0002'; end if;
  if fam is distinct from current_family_id() then
    raise exception '无权操作这条记录' using errcode = '42501';
  end if;
  if st <> 'draft' then return; end if;   -- 幂等：重复调用不重复计数

  update meal_orders set status = 'confirmed', confirmed_at = now() where id = p_order;

  update dishes d
     set eat_count     = d.eat_count + 1,
         last_eaten_at = now()
    from meal_order_items i
   where i.order_id = p_order and d.id = i.dish_id;
end $$;

-- -----------------------------------------------------------------------------
-- 10. 有记忆的随机（README 第 13 节）
--     权重 = 高频降权 × 久未吃加权 × 近7天排除 × 收藏加成 × 全家偏好 × 荤素平衡
--     抽样用 Gumbel top-k（-ln(U)/w 升序取前 N），等价于「按权重不放回抽样」，
--     所以随机一桌不会出现同一道菜占两个槽位。
-- -----------------------------------------------------------------------------
create or replace function random_dish(
  p_meal_type   text   default null,
  p_category    text   default null,
  p_ingredient  int    default null,
  p_method      int    default null,
  p_tag         text   default null,
  p_exclude     uuid[] default '{}',
  p_limit       int    default 1
) returns table (
  dish_id    uuid,
  dish_name  text,
  category   text,
  subcategory text,
  cooking_time int,
  score      numeric,
  days_since numeric,
  eat_count  int,
  reasons    jsonb
) language plpgsql as $$
begin
  return query
  with cand as (
    select d.id, d.name, d.category, d.subcategory, d.cooking_time, d.eat_count, d.is_favorite,
           round(coalesce(extract(epoch from (now() - d.last_eaten_at)) / 86400.0, 999)::numeric, 1) as days_since
      from dishes d
     where d.family_id = public.current_family_id()
       and d.is_active
       and (p_meal_type  is null or d.meal_type        = p_meal_type)
       and (p_category   is null or d.category         = p_category)
       and (p_ingredient is null or d.ingredient_id    = p_ingredient)
       and (p_method     is null or d.cooking_method_id = p_method)
       and (p_tag is null or exists (
              select 1 from dish_tags dt join tags t on t.id = dt.tag_id
               where dt.dish_id = d.id and t.name = p_tag))
       and not (d.id = any (coalesce(p_exclude, '{}')))
  ),
  pref as (
    select p.dish_id,
           case when bool_and(p.pref = 1)  then 1.6
                when bool_or(p.pref = -1)  then 0.25
                else 1.1 end as boost,
           count(*) filter (where p.pref = 1)  as liked_by,
           count(*) filter (where p.pref = -1) as disliked_by
      from member_dish_preferences p
      join family_members m on m.id = p.member_id
     where m.family_id = public.current_family_id()
     group by p.dish_id
  ),
  weekly as (
    select d2.category, count(*)::int as n
      from meal_order_items i
      join meal_orders o on o.id = i.order_id and o.status <> 'draft'
      join dishes d2     on d2.id = i.dish_id
     where o.family_id = public.current_family_id()
       and o.meal_date >= current_date - 7
     group by d2.category
  ),
  scored as (
    select c.*,
           round((
               (1.0 / (1.0 + c.eat_count / 20.0))
             * (1 + least(c.days_since, 90) / 45.0)
             * (case when c.days_since < 7 then 0.15 else 1.0 end)
             * (case when c.is_favorite then 1.3 else 1.0 end)
             * coalesce(pf.boost, 1.0)
             * (case when coalesce(w.n, 0) = 0 then 1.25 else 1.0 / (1 + w.n * 0.15) end)
           )::numeric, 4) as score,
           coalesce(pf.boost, 1.0) as pref_boost,
           coalesce(pf.liked_by, 0) as liked_by,
           coalesce(pf.disliked_by, 0) as disliked_by,
           coalesce(w.n, 0) as week_n
      from cand c
      left join pref   pf on pf.dish_id = c.id
      left join weekly w  on w.category = c.category
  )
  select s.id, s.name, s.category, s.subcategory, s.cooking_time, s.score, s.days_since, s.eat_count,
         jsonb_build_array(
           jsonb_build_object('key','stale',  'label','很久没吃',
             'detail', case when s.days_since >= 999 then '从来没点过' else s.days_since || ' 天没吃' end,
             'weight', round(least(s.days_since, 90) / 90.0, 2)),
           jsonb_build_object('key','freq',   'label','历史频次',
             'detail', '一共点过 ' || s.eat_count || ' 次',
             'weight', round(greatest(0.0, 1 - s.eat_count / 40.0), 2)),
           jsonb_build_object('key','recent', 'label','近期吃过',
             'detail', case when s.days_since < 7 then '7 天内吃过，已大幅降权' else '最近 7 天没吃' end,
             'weight', case when s.days_since < 7 then 0.15 else 1 end),
           jsonb_build_object('key','fav',    'label','收藏',
             'detail', case when s.is_favorite then '在收藏夹里' else '未收藏' end,
             'weight', case when s.is_favorite then 1 else 0 end),
           jsonb_build_object('key','pref',   'label','全家偏好',
             'detail', s.liked_by || ' 人喜欢 · ' || s.disliked_by || ' 人不喜欢',
             'weight', round(least(s.pref_boost, 1.6) / 1.6, 2)),
           jsonb_build_object('key','balance','label','荤素平衡',
             'detail', '本周「' || s.category || '」已点 ' || s.week_n || ' 次',
             'weight', round(greatest(0.0, 1 - s.week_n * 0.15), 2))
         )
    from scored s
   order by -ln(random()) / nullif(s.score::double precision, 0)
   limit greatest(1, p_limit);
end $$;

-- 随机一桌：按 table_plan 逐槽取菜，槽间互斥
create or replace function random_table(p_people int default 3, p_meal_type text default '正餐')
returns table (slot int, category text, subcategory text, dish_id uuid, dish_name text, cooking_time int, score numeric)
language plpgsql as $$
declare s record; r record; picked uuid[] := '{}'; n int := 0;
begin
  for s in select tp.category, tp.subcategory, tp.qty, tp.sort
             from table_plan tp
            where tp.meal_type = p_meal_type
              and p_people between tp.min_people and tp.max_people
            order by tp.sort
  loop
    for r in select * from random_dish(
                p_meal_type  := p_meal_type,
                p_category   := s.category,
                p_exclude    := picked,
                p_limit      := s.qty)
    loop
      n := n + 1;
      picked := picked || r.dish_id;
      slot := n; category := r.category; subcategory := r.subcategory;
      dish_id := r.dish_id; dish_name := r.dish_name;
      cooking_time := r.cooking_time; score := r.score;
      return next;
    end loop;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 11. 行级安全（README 第 29 节功能的安全底座）
--     全部策略对 anon 与 authenticated 同时生效；非成员查不到任何行。
-- -----------------------------------------------------------------------------
alter table families                enable row level security;
alter table family_members          enable row level security;
alter table dishes                  enable row level security;
alter table dish_tags               enable row level security;
alter table member_dish_preferences enable row level security;
alter table meal_orders             enable row level security;
alter table meal_order_items        enable row level security;

-- 字典表：所有人可读，只有 service_role 可写（前端不给写权限）
alter table ingredients     enable row level security;
alter table cooking_methods enable row level security;
alter table tags            enable row level security;
alter table category_dict   enable row level security;
alter table table_plan      enable row level security;
create policy dict_read on ingredients     for select using (true);
create policy dict_read on cooking_methods for select using (true);
create policy dict_read on tags            for select using (true);
create policy dict_read on category_dict   for select using (true);
create policy dict_read on table_plan      for select using (true);

-- families：本家庭可读；只有 owner 能改；建家走 RPC，不开直接 insert
create policy fam_read  on families for select using (id = public.current_family_id());
create policy fam_write on families for update using (id = public.current_family_id() and owner_uid = auth.uid());

-- family_members：本家庭可见；改名走 RPC，不开直接 insert
create policy mem_read  on family_members for select using (family_id = public.current_family_id());
create policy mem_self  on family_members for update using (auth_uid = auth.uid());

-- dishes：本家庭全 CRUD
create policy dish_all on dishes for all
  using       (family_id = public.current_family_id())
  with check  (family_id = public.current_family_id());

-- dish_tags：通过父表 dishes 隔离
create policy dt_all on dish_tags for all
  using      (exists (select 1 from dishes d where d.id = dish_id   and d.family_id = public.current_family_id()))
  with check (exists (select 1 from dishes d where d.id = dish_id   and d.family_id = public.current_family_id()));

-- member_dish_preferences：只能改自己的票，且菜必须是自己家的
create policy pref_read on member_dish_preferences for select
  using (exists (select 1 from family_members m where m.id = member_id and m.family_id = public.current_family_id()));
create policy pref_write on member_dish_preferences for insert
  with check (member_id = public.current_member_id()
          and exists (select 1 from dishes d where d.id = dish_id and d.family_id = public.current_family_id()));
create policy pref_update on member_dish_preferences for update using (member_id = public.current_member_id());
create policy pref_delete on member_dish_preferences for delete using (member_id = public.current_member_id());

-- meal_orders：本家庭全 CRUD，且 family_id 必须是自己家
create policy mo_all on meal_orders for all
  using      (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

-- meal_order_items：通过父表 meal_orders 隔离
create policy moi_all on meal_order_items for all
  using      (exists (select 1 from meal_orders o where o.id = order_id and o.family_id = public.current_family_id()))
  with check (exists (select 1 from meal_orders o where o.id = order_id and o.family_id = public.current_family_id()));

-- 授权（Supabase 默认已给 anon/authenticated 表权限，这里显式补齐防漂移）
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
grant execute on function create_family(text, text)                      to anon, authenticated;
grant execute on function join_family(text, text)                        to anon, authenticated;
grant execute on function rename_self(text)                              to anon, authenticated;
grant execute on function confirm_order(uuid)                            to anon, authenticated;
grant execute on function random_dish(text, text, int, int, text, uuid[], int) to anon, authenticated;
grant execute on function random_table(int, text)                        to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 12. Storage：菜品图。桶公开读（<img> 直接引用），写按家庭目录隔离。
--     上传前必须在前端压到 <= 200KB（免费层 1GB 存储 / 5GB 月出口）
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('dish-images', 'dish-images', true)
on conflict (id) do nothing;

create policy "dish images read" on storage.objects for select
  using (bucket_id = 'dish-images');

create policy "dish images write" on storage.objects for insert to authenticated
  with check (bucket_id = 'dish-images'
              and (storage.foldername(name))[1] = public.current_family_id()::text);

create policy "dish images update" on storage.objects for update to authenticated
  using (bucket_id = 'dish-images'
         and (storage.foldername(name))[1] = public.current_family_id()::text);

create policy "dish images delete" on storage.objects for delete to authenticated
  using (bucket_id = 'dish-images'
         and (storage.foldername(name))[1] = public.current_family_id()::text);
