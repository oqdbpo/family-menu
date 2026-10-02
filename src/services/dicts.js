import { sb } from '../lib/supabase';

// 字典表全局共用、几乎不变，所以只拉一次并复用同一个 promise。
// 失败时必须把缓存清掉，否则一次网络抖动会永久卡在 rejected promise 上。
let cache = null;

export function loadDicts(force = false) {
  if (cache && !force) return cache;
  cache = (async () => {
    const [ing, mth, tg, cat, plan] = await Promise.all([
      sb.from('ingredients').select('id,name,kind').order('id'),
      sb.from('cooking_methods').select('id,name').order('id'),
      sb.from('tags').select('id,name,kind').order('kind,name'),
      sb.from('category_dict').select('meal_type,category,subcategory,sort').order('sort'),
      sb.from('table_plan').select('*').order('sort'),
    ]);
    for (const r of [ing, mth, tg, cat, plan]) if (r.error) throw r.error;

    const categories = {};
    for (const c of cat.data) {
      (categories[c.meal_type] ||= []).push(c);
    }
    return {
      ingredients: ing.data,
      methods: mth.data,
      tags: tg.data,
      categoryList: cat.data,
      categories,          // { 正餐: [{category, subcategory}], 早餐: [...] }
      tablePlan: plan.data,
      nameOf: {
        ingredient: id => ing.data.find(i => i.id === id)?.name || '',
        method: id => mth.data.find(m => m.id === id)?.name || '',
      },
    };
  })().catch(err => { cache = null; throw err; });
  return cache;
}
