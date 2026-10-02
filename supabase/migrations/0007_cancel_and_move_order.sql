-- =============================================================================
-- 0007 · 反悔：取消已确认的一顿，以及把一顿挪到别的餐次/日期
--
-- 这推翻了 README 里「已确认的餐锁死不可改」那条不变量。原来的判断是对的
-- （实测发生过确认后被追加 8 道菜、eat_count 和记录对不上），但结论下重了：
-- 真正不能改的是「算错的统计」，不是「状态」。所以这里不是松开锁，
-- 而是让取消这条路把统计**重算**干净。
--
-- 顺手收掉一个双真相源：confirm_order 原来是增量 +1，而 seed.sql 是全量重算，
-- 同一件事两套算法，只要有一处漏跑就永久对不上。现在两者都走
-- refresh_family_stats()，只有一处算数。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. 唯一一处统计口径：按"已确认的订单项"全量重算这个家所有菜的 eat_count
--    必须 left join：一道菜的历史被取消干净时，要能归零；
--    只 update 命中行的写法会把它永远留在 1（0004 清理时实测踩过）。
--    eat_count 数的是"出现过几次"，不按 quantity 加权，与原 confirm_order 一致。
-- -----------------------------------------------------------------------------
create or replace function refresh_family_stats(p_family uuid) returns void
language sql security definer set search_path = public as $$
  update dishes d
     set eat_count     = coalesce(s.n, 0),
         last_eaten_at = s.last
    from (
          select d2.id, x.n, x.last
            from dishes d2
            left join (
                  select i.dish_id, count(*)::int as n, max(o.confirmed_at) as last
                    from meal_order_items i
                    join meal_orders o on o.id = i.order_id
                   where o.status <> 'draft'
                     and o.family_id = p_family
                   group by i.dish_id
            ) x on x.dish_id = d2.id
           where d2.family_id = p_family
    ) s
   where d.id = s.id;
$$;
-- 内部helper，不对外开：没有客户端调它的理由
revoke execute on function refresh_family_stats(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1. confirm_order 改为走统一口径（行为不变：幂等，不重复计数）
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
  if st <> 'draft' then return; end if;   -- 幂等

  update meal_orders set status = 'confirmed', confirmed_at = now() where id = p_order;
  perform refresh_family_stats(fam);
end $$;

-- -----------------------------------------------------------------------------
-- 2. 取消确认：退回草稿 + 重算统计
--    只允许今天及以后 —— 已经吃过的那一顿是历史，改它等于回头改写 stats，
--    家里人会发现"很久没吃"的权重莫名其妙变了。这条由数据库把关，不靠前端藏按钮。
--
--    时区有个已知的一天宽限，别当成 bug：Supabase 会话时区是 UTC，
--    而 meal_date 是家里人日历上的日期。北京时间 00:00–08:00 这段时间里，
--    "昨天"在服务端还没跨天，所以还能取消。放宽的方向是安全的（顶多多给一次反悔），
--    比在 SQL 里写死 Asia/Shanghai 更适合一个通用 schema。
-- -----------------------------------------------------------------------------
create or replace function cancel_order(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
declare fam uuid; st text; on_day date;
begin
  select family_id, status, meal_date into fam, st, on_day from meal_orders where id = p_order;
  if fam is null then raise exception '点餐记录不存在' using errcode = 'P0002'; end if;
  if fam is distinct from current_family_id() then
    raise exception '无权操作这条记录' using errcode = '42501';
  end if;
  if st = 'draft' then return; end if;   -- 幂等：已经是草稿就没什么可取消的

  if on_day < current_date then
    raise exception '%月%日那顿是吃过的历史，不能取消',
      to_char(on_day, 'FMMM'), to_char(on_day, 'FMDD') using errcode = 'P0001';
  end if;

  update meal_orders set status = 'draft', confirmed_at = null where id = p_order;
  perform refresh_family_stats(fam);
end $$;

-- -----------------------------------------------------------------------------
-- 3. 挪餐次/日期：只挪草稿。已确认的要先取消（保持"确认即冻结"这一条不变），
--    目标位置已有别的一单时直接拒绝 —— 自动合并会把"这顿原本谁定的"抹掉。
-- -----------------------------------------------------------------------------
create or replace function move_order(p_order uuid, p_date date, p_meal_type text) returns void
language plpgsql security definer set search_path = public as $$
declare fam uuid; st text; hit uuid;
begin
  select family_id, status into fam, st from meal_orders where id = p_order;
  if fam is null then raise exception '点餐记录不存在' using errcode = 'P0002'; end if;
  if fam is distinct from current_family_id() then
    raise exception '无权操作这条记录' using errcode = '42501';
  end if;
  if st <> 'draft' then
    raise exception '先取消确认，再挪这一顿' using errcode = 'P0001';
  end if;
  if p_date < current_date then
    raise exception '不能挪到今天以前' using errcode = 'P0001';
  end if;
  if p_meal_type not in ('早餐','午餐','晚餐','其他') then
    raise exception '没有「%」这个餐次', p_meal_type using errcode = '22007';
  end if;

  select id into hit from meal_orders
    where family_id = fam and meal_date = p_date and meal_type = p_meal_type
      and id <> p_order;
  if hit is not null then
    raise exception '%已经有一单了，先去那单里调整或清空，再来挪',
      to_char(p_date, 'FMMM月FMDD日') || p_meal_type using errcode = '23505';
  end if;

  update meal_orders set meal_date = p_date, meal_type = p_meal_type where id = p_order;
end $$;

grant execute on function confirm_order(uuid) to anon, authenticated;
grant execute on function cancel_order(uuid)  to anon, authenticated;
grant execute on function move_order(uuid, date, text) to anon, authenticated;

notify pgrst, 'reload schema';
