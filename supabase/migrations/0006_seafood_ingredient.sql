-- =============================================================================
-- 0006 · 「其他海鲜」是**主食材**，不是分类细分
--
-- ⚠ 本文件被重写过一次。第一版误把「其他海鲜」塞进 category_dict 当成荤菜的细分，
-- 而它其实属于 ingredients（README 原则一：分类与食材分离——"其他海鲜"说的是
-- 这条菜用什么料，不是它算哪一类）。已经跑过旧版的那台库由下面第 1 步**显式撤销**，
-- 所以重跑本文件、或从零装一套，落到的都是同一个结果。
--
-- 同样不需要改任何前端代码：录入页的「主食材」下拉直接读 ingredients，
-- 点菜页的食材筛选条也来自它。
-- =============================================================================

-- 1. 撤销放错位置的那条细分，并恢复被它打标的菜
delete from category_dict
 where meal_type = '正餐' and category = '荤菜' and subcategory = '其他海鲜';

update dishes set subcategory = '' where subcategory = '其他海鲜';

-- 2. 加进食材字典。水产这一类原本只有 鱼 / 虾 / 螃蟹，贝类螺类没处可归
insert into ingredients (name, kind) values ('其他海鲜', '水产')
on conflict (name) do nothing;

-- 校验：
-- select name, kind from ingredients where kind = '水产';          -- 应有 其他海鲜
-- select * from category_dict where category = '荤菜';             -- 应只剩 subcategory='' 那一行
-- select count(*) from dishes where subcategory = '其他海鲜';       -- 应为 0
