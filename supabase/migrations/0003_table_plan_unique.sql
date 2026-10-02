-- =============================================================================
-- 0003 · table_plan 去重 + 唯一约束
--
-- 起因：seed.sql 里所有 insert 都带了 on conflict 兜底，唯独 table_plan 没有
-- （建表时也没给它唯一键）。重跑一次 seed 就多出一整份副本，实测攒到 3 份 33 行，
-- random_table 于是把"一桌 4 个槽"跑成了 11 道菜——因为它按 table_plan 逐行取菜，
-- 每行都取一遍。这是重跑 seed 造成的数据问题，不是算法问题。
-- =============================================================================

-- 1. 先删重复：同一 (餐次, 人数区间, 分类, 细分, 槽位序) 只保留 id 最小的那行
delete from table_plan a
 where a.id <> (select min(b.id) from table_plan b
                 where b.meal_type   is not distinct from a.meal_type
                   and b.min_people  is not distinct from a.min_people
                   and b.max_people  is not distinct from a.max_people
                   and b.category    is not distinct from a.category
                   and b.subcategory is not distinct from a.subcategory
                   and b.sort        is not distinct from a.sort);

-- 2. 补唯一约束，让"重跑 seed 变三份"这件事在数据库层面不可能再发生
create unique index if not exists table_plan_slot_uniq
  on table_plan (meal_type, min_people, max_people, category, subcategory, sort);

-- 3. 索引变动后让 PostgREST 重新缓存一次 schema（新建函数时必须做，索引同理保险）
notify pgrst, 'reload schema';

-- 校验：期望 11 行 / 11 个唯一槽位，且 random_table(3, 正餐) 返回 4 道
-- select count(*) as rows, count(distinct (meal_type,min_people,max_people,category,subcategory,sort)) as uniq from table_plan;
