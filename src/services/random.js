import { sb } from '../lib/supabase';

// 权重全部在数据库里算（README 33.3：业务逻辑与 UI 分离）。
// 前端只拿 { dish_name, score, reasons[] } 来画，三端共用同一份分数。
export async function randomDish(filters = {}) {
  const { data, error } = await sb.rpc('random_dish', {
    p_meal_type:  filters.mealType     || null,
    p_category:   filters.category     || null,
    p_ingredient: filters.ingredientId || null,
    p_method:     filters.methodId     || null,
    p_tag:        filters.tag          || null,
    p_exclude:    filters.exclude      || [],
    p_limit:      filters.limit        || 1,
  });
  if (error) throw error;
  return data || [];
}

export async function randomTable(people = 3, mealType = '正餐') {
  const { data, error } = await sb.rpc('random_table', { p_people: people, p_meal_type: mealType });
  if (error) throw error;
  return data || [];
}
