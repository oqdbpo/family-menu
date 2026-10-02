-- =============================================================================
-- 0002：让数据库自己盖 family_id，客户端不再传
--
-- 起因：真机自检报 HTTP 403 "new row violates row-level security policy
-- for table meal_orders"。因为 0001 里 family_id 只声明了 not null 没有默认值，
-- 客户端必须显式传，而 mo_all 策略的 with check 要求它等于 current_family_id()。
--
-- 两层问题：
--   1) 易用性 —— 每个 insert 都得记得带 family_id，迟早漏
--   2) 安全  —— 让客户端提供租户 ID 本身就是反模式。传对了能过 check，
--      那如果哪天策略写松了，就能往别人家写数据
--
-- 改成列默认值取 current_family_id()（SECURITY DEFINER，内部可查 family_members），
-- 客户端根本不碰这一列，策略的 with check 退化成一道冗余保险。
--
-- 本文件幂等，在 0001 之后执行；对已经跑过 0001 的项目直接跑即可。
-- =============================================================================

alter table dishes      alter column family_id set default public.current_family_id();
alter table meal_orders alter column family_id set default public.current_family_id();

-- 建单人同样由数据库按当前设备身份填，不靠前端传
alter table meal_orders alter column created_by set default public.current_member_id();
