import { sb } from '../lib/supabase';
import { submit } from '../lib/db';

export const DISH_SELECT = `id,name,meal_type,category,subcategory,ingredient_id,cooking_method_id,
description,image_path,spicy_level,difficulty,cooking_time,is_favorite,is_active,eat_count,last_eaten_at,
dish_tags(tags(name,kind))`;

const shape = rows => rows.map(({ dish_tags, ...d }) => ({
  ...d,
  tags: (dish_tags || []).map(x => x.tags).filter(Boolean),
}));

// 家庭规模的菜库一次全量拉回来，前端派生筛选 —— 点 chip 才能零延迟，且离线可用。
// 数据量真到了几千道再换成分页，接口形状不用变。
export async function fetchDishes({ includeInactive = false } = {}) {
  let q = sb.from('dishes').select(DISH_SELECT).order('category').order('name');
  if (!includeInactive) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw error;
  return shape(data || []);
}

export async function fetchFavorites() {
  const { data, error } = await sb.from('dishes').select(DISH_SELECT)
    .eq('is_favorite', true).eq('is_active', true).order('name');
  if (error) throw error;
  return shape(data || []);
}

export async function fetchFrequent() {
  const { data, error } = await sb.from('dishes').select(DISH_SELECT)
    .gt('eat_count', 0).eq('is_active', true).order('eat_count', { ascending: false }).limit(30);
  if (error) throw error;
  return shape(data || []);
}

export async function toggleFavorite(dish, next) {
  const value = next ?? !dish.is_favorite;
  const r = await submit({ type: 'update', table: 'dishes', row: { is_favorite: value }, match: { id: dish.id } },
    { label: `收藏 ${dish.name}` });
  if (!r.error) dish.is_favorite = value;
  return r;
}

export async function setActive(dish, next) {
  const value = next ?? !dish.is_active;
  const r = await submit({ type: 'update', table: 'dishes', row: { is_active: value }, match: { id: dish.id } },
    { label: `${value ? '启用' : '停用'} ${dish.name}` });
  if (!r.error) dish.is_active = value;
  return r;
}

export async function saveDish(dish, tagIds = []) {
  const row = {
    name: dish.name.trim(),
    meal_type: dish.meal_type,
    category: dish.category,
    subcategory: dish.subcategory || '',
    ingredient_id: dish.ingredient_id || null,
    cooking_method_id: dish.cooking_method_id || null,
    description: dish.description?.trim() || null,
    image_path: dish.image_path || null,
    spicy_level: Number(dish.spicy_level) || 0,
    difficulty: Number(dish.difficulty) || 1,
    cooking_time: Number(dish.cooking_time) || 15,
    is_favorite: !!dish.is_favorite,
    is_active: dish.is_active ?? true,
  };
  const r = dish.id
    ? await submit({ type: 'update', table: 'dishes', row, match: { id: dish.id } }, { label: `更新 ${row.name}` })
    : await submit({ type: 'insert', table: 'dishes', row: { ...row, id: dish.id || undefined } }, { label: `新增 ${row.name}` });
  if (!r.error && dish.id && tagIds) await replaceTags(dish.id, tagIds);
  return r;
}

export async function replaceTags(dishId, tagIds) {
  const { data, error } = await sb.from('dish_tags').delete().eq('dish_id', dishId).select('tag_id');
  if (error) throw error;
  if (!tagIds.length) return;
  const { error: e2 } = await sb.from('dish_tags').insert(tagIds.map(tag_id => ({ dish_id: dishId, tag_id })));
  if (e2) throw e2;
}

// 有历史记录的菜数据库会拒绝物理删除（on delete restrict），这是故意的
export async function removeDish(dish) {
  const { error } = await sb.from('dishes').delete().eq('id', dish.id);
  if (error && /foreign key|restrict/i.test(error.message)) {
    error.friendly = '这道菜有点餐记录，不能删除。改成「停用」就不会出现在点餐列表里，历史记录也保留。';
  }
  if (error) throw error;
}
