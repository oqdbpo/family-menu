-- =============================================================================
-- 清理没有对应成员的匿名身份
--
-- 来历：verify.mjs 每跑一轮、每次本地联调、每一次 curl 冒烟，都会
-- signInAnonymously 出一个 auth.users 身份。0004 之后 verify 会自删，
-- 但在那之前积累的还在 Auth 里。它们不是任何家庭的成员，查不到任何数据，
-- 只是堆在 Auth 列表里、并计入免费额度的 MAU。
--
-- 判据只有一条：没有任何 family_members 行的 auth_uid 指向它。
-- 真家庭成员（哪怕暂时离线）一律不会被删。
-- 注意：如果某台设备的浏览器里存着一个"没加入过家庭"的匿名会话，
-- 删掉后它下次打开会拿到 401，需要重新匿名登录一次——不影响已加入的家庭数据。
-- =============================================================================

delete from auth.users u
 where not exists (select 1 from family_members m where m.auth_uid = u.id);

select json_build_object(
  '剩余身份',   (select count(*) from auth.users),
  '成员行',     (select count(*) from family_members),
  '已绑定设备', (select count(auth_uid) from family_members),
  '仍然无主',   (select count(*) from auth.users u
                  where not exists (select 1 from family_members m where m.auth_uid = u.id))
) as after_cleanup;
