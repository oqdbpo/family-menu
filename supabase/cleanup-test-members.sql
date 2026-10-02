-- =============================================================================
-- 清理示范家庭里由自检 / 联调留下的真实设备成员，以及他们名下的测试订单
--
-- 来历：supabase/verify.mjs 每跑一次就 signInAnonymously 一个新身份并 join_family，
--       本地 dev 与浏览器联调也各留了一个。种子数据里那三位（爸爸/妈妈/孩子）的
--       auth_uid 是 NULL，所以判据用 auth_uid is not null 即可精确区分。
-- 顺序：先删订单（否则 created_by 会被 on delete set null 静默置空，归属信息就没了），
--       再删成员，最后全量重算统计。
-- 可重复执行：删完再跑一次不会报错，也不会误伤种子数据。
-- =============================================================================

begin;

-- 1. 待删成员名下订单的明细
delete from meal_order_items i
 where i.order_id in (
   select o.id from meal_orders o
    where o.created_by in (
      select id from family_members
       where family_id = '11111111-1111-1111-1111-111111111111'
         and auth_uid is not null));

-- 2. 待删成员名下的订单
delete from meal_orders o
 where o.created_by in (
   select id from family_members
    where family_id = '11111111-1111-1111-1111-111111111111'
      and auth_uid is not null);

-- 3. 成员本身（member_dish_preferences 由 on delete cascade 带走）
delete from family_members
 where family_id = '11111111-1111-1111-1111-111111111111'
   and auth_uid is not null;

-- 4. 全量重算。注意 seed.sql 里那版只会 update 掉「有历史」的菜，
--    测试订单被删光、历史归零的那些菜不会被重置回 0，所以这里补 left join 全量覆盖
update dishes d
   set eat_count = coalesce(s.n, 0),
       last_eaten_at = s.last
  from (
        select d2.id, x.n, x.last
          from dishes d2
          left join (
                select i.dish_id, count(*)::int as n, max(o.confirmed_at) as last
                  from meal_order_items i
                  join meal_orders o on o.id = i.order_id
                 where o.status <> 'draft'
                 group by i.dish_id
          ) x on x.dish_id = d2.id
  ) s
 where d.id = s.id;

commit;

-- 复核：期望 members=3（爸爸/妈妈/孩子）· bound=0 · orders 回到种子的量 ·
--       且没有任何一道菜的 eat_count 只剩测试带来的那 1 次
select json_build_object(
  'members',       (select count(*) from family_members),
  '已绑定设备',     (select count(auth_uid) from family_members),
  '种子占位',       (select count(*) - count(auth_uid) from family_members),
  '偏好条数',       (select count(*) from member_dish_preferences),
  '订单',           (select count(*) from meal_orders),
  '明细',           (select count(*) from meal_order_items),
  '有历史的菜',     (select count(*) from dishes where eat_count > 0),
  '从没点过的菜',   (select count(*) from dishes where eat_count = 0),
  '总吃到次数',     (select coalesce(sum(eat_count),0) from dishes)
) as after_cleanup;
