-- =============================================================================
-- 0006 · 荤菜下新增「其他海鲜」细分
--
-- 这条只需要改数据，不需要改代码：录入端 DishForm 和点菜端 Order 的细分胶囊
-- 都是从 category_dict 现读的（Order.vue 按 meal_type+category 过滤出非空 subcategory，
-- stores/dishes.js 按 d.subcategory 筛）。这正是 README「选项全部来自数据库，
-- 不写死在前端」要的效果 —— 加一个分类 = 插一行。
-- =============================================================================

-- sort 各占一段：一级分类 1~6，火锅细分 301~，荤菜细分从 101 起。
-- 挤进 1~6 会把分类胶囊的排序打乱（第一次写的时候就踩成了 火锅/汤 同 sort=4）
insert into category_dict (meal_type, category, subcategory, sort)
values ('正餐', '荤菜', '其他海鲜', 101)
on conflict (meal_type, category, subcategory) do nothing;

-- 只给示范家庭的演示数据打标，让新分类一点进去就能看到效果。
-- 真家庭（小确幸）的菜一律不动：把它们归到哪个细分是吃饭的人说了算，
-- 需要的话按菜名批量填，但要另外确认。
update dishes d
   set subcategory = '其他海鲜'
 where d.category = '荤菜'
   and coalesce(d.subcategory, '') = ''
   and d.name ~ '鱼|虾|蟹|贝|蛤|螺'
   and d.family_id = (select id from families where invite_code = 'DEMO01');

-- 校验：期望示范家庭里清蒸鲈鱼 / 白灼虾 两行变成 其他海鲜
-- select name, subcategory from dishes
--  where family_id = (select id from families where invite_code='DEMO01') and category='荤菜' and subcategory <> '';
