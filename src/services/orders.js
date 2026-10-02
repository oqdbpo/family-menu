import { sb } from '../lib/supabase';
import { submit, uuid } from '../lib/db';
import { DISH_SELECT } from './dishes';

export const MEAL_TYPES = ['早餐', '午餐', '晚餐', '其他'];
export const todayISO = (d = new Date()) => {
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
};

const flatten = rows => rows.map(({ dishes, ...item }) => ({ ...item, dish: dishes ? {
  ...dishes, tags: (dishes.dish_tags || []).map(x => x.tags).filter(Boolean), dish_tags: undefined,
} : null }));

export async function getOrderByMeal(date, mealType) {
  const { data, error } = await sb.from('meal_orders')
    .select('id,meal_date,meal_type,status,created_by,confirmed_at')
    .eq('meal_date', date).eq('meal_type', mealType).maybeSingle();
  if (error) throw error;
  return data;
}

export async function loadOrder(order) {
  const { data, error } = await sb.from('meal_order_items')
    .select(`id,order_id,dish_id,quantity,category,dishes(${DISH_SELECT})`)
    .eq('order_id', order.id);
  if (error) throw error;
  return { ...order, items: flatten(data || []) };
}

export async function ensureDraft(date, mealType) {
  let o = await getOrderByMeal(date, mealType);
  if (o) return o;
  const id = uuid();                       // 客户端生成主键，离线时也能把整条链排进队列
  const { data, error } = await sb.from('meal_orders')
    .insert({ id, meal_date: date, meal_type: mealType, status: 'draft' })
    .select('id,meal_date,meal_type,status,created_by,confirmed_at').single();
  if (error && /23505|duplicate key/i.test(`${error.code} ${error.message}`)) {
    // 两次并发点击同时判定"没有草稿"，后插的那个撞唯一约束；回读赢的那个即可
    const again = await getOrderByMeal(date, mealType);
    if (again) return again;
  }
  if (error) throw error;
  return data;
}

export async function setItemQuantity(order, dish, quantity) {
  if (quantity <= 0) {
    const existing = order.items.find(i => i.dish_id === dish.id);
    if (!existing) return { queued: false };
    const r = await submit({ type: 'delete', table: 'meal_order_items', id: existing.id }, { label: `移除 ${dish.name}` });
    if (!r.error) order.items = order.items.filter(i => i.id !== existing.id);
    return r;
  }
  const r = await submit({
    type: 'upsert', table: 'meal_order_items',
    row: { order_id: order.id, dish_id: dish.id, quantity, category: dish.category },
    onConflict: 'order_id,dish_id',
  }, { label: `点 ${dish.name}` });
  if (!r.error) {
    const hit = order.items.find(i => i.dish_id === dish.id);
    if (hit) hit.quantity = quantity;
    else order.items.push({ id: null, order_id: order.id, dish_id: dish.id, quantity, category: dish.category, dish });
  }
  return r;
}

export async function confirmOrder(order) {
  const r = await submit({ type: 'rpc', fn: 'confirm_order', args: { p_order: order.id } }, { label: '确认点餐' });
  if (!r.error) order.status = 'confirmed';
  return r;
}

export async function recentHistory(limit = 30) {
  const { data: orders, error } = await sb.from('meal_orders')
    .select('id,meal_date,meal_type,status,confirmed_at')
    .neq('status', 'draft').order('meal_date', { ascending: false }).limit(limit);
  if (error) throw error;
  return Promise.all(orders.map(o => loadOrder(o)));
}

export async function weekStats() {
  const since = todayISO(new Date(Date.now() - 6 * 864e5));
  const { data, error } = await sb.from('meal_order_items')
    .select('quantity, category, dishes(id,name,eat_count), order:meal_orders(meal_date,status)')
    .gte('order.meal_date', since).neq('order.status', 'draft');
  if (error) throw error;
  const meals = new Set((data || []).map(r => `${r.order?.meal_date}|${r.category}`)).size;
  const dishes = new Set((data || []).map(r => r.dishes?.id)).size;
  return { meals, dishes, raw: data || [] };
}
