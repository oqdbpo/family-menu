import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { todayISO, getOrderByMeal, ensureDraft, loadOrder, setItemQuantity,
         confirmOrder, cancelOrder, moveOrder, recentHistory } from '../services/orders';
import { submit } from '../lib/db';
import { classifyError } from '../config';

const guessMeal = () => {
  const h = new Date().getHours();
  if (h < 10) return '早餐';
  if (h < 15) return '午餐';
  return '晚餐';
};

export const useOrderStore = defineStore('order', () => {
  const date = ref(todayISO());
  const mealType = ref(guessMeal());
  const order = ref(null);
  const loading = ref(false);
  const error = ref(null);
  const history = ref([]);

  const items = computed(() => order.value?.items || []);
  const count = computed(() => items.value.length);
  const totalMinutes = computed(() => {
    // 四口锅并行，取最耗时的那道而不是求和
    return items.value.reduce((m, i) => Math.max(m, i.dish?.cooking_time || 0), 0);
  });
  const qtyOf = dishId => items.value.find(i => i.dish_id === dishId)?.quantity || 0;
  const isDraft = computed(() => !order.value?.id || order.value.status === 'draft');
  // 确认之后这顿暂时冻结，直到按「取消点餐」退回草稿。
  // 之前没有拦，实测真被追加过 8 道菜，结果 eat_count 和点餐记录对不上。
  const locked = computed(() => !!order.value?.id && order.value.status !== 'draft');
  // 只有今天及以后能取消：吃过的顿是历史，改它等于回头改写统计。
  // 数据库里（0007）有同一道闸，这里只决定按钮长什么样，不是防护
  const canCancel = computed(() => locked.value && order.value.meal_date >= todayISO());

  // 只是「看」一眼今日点餐不应该在库里留行 —— 建单推迟到第一次加菜。
  // 之前 ensureDraft 挂在 load 上，光是浏览页面就会攒出一堆空草稿。
  const emptyHead = () => ({ id: null, meal_date: date.value, meal_type: mealType.value, status: 'draft', items: [] });

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      const head = await getOrderByMeal(date.value, mealType.value);
      order.value = head ? await loadOrder(head) : emptyHead();
    } catch (e) {
      error.value = classifyError(e);
    } finally {
      loading.value = false;
    }
  }

  // 连点两下"加菜"会并发触发两次建单，第二次撞 meal_orders 的唯一约束。
  // 用同一个 in-flight promise 收口，保证并发只建一次。
  let inflight = null;
  async function ensureOrder() {
    if (order.value?.id) return order.value;
    if (inflight) return inflight;
    inflight = (async () => {
      order.value = await loadOrder(await ensureDraft(date.value, mealType.value));
      return order.value;
    })().finally(() => { inflight = null; });
    return inflight;
  }

  async function setMealType(t) { if (t !== mealType.value) { mealType.value = t; await load(); } }
  async function setDate(d)    { if (d !== date.value) { date.value = d; await load(); } }

  async function add(dish)     { return setQty(dish, qtyOf(dish.id) + 1); }
  async function dropOrder(o) {
    const r = await submit({ type: 'delete', table: 'meal_orders', id: o.id }, { label: '清空这顿' });
    if (!r.error) order.value = emptyHead();
    return r;
  }

  // services 层出错是 throw，store 必须收口成 { error } 返回，
  // 否则异常会一路冒到模板的事件处理器上，Vue 报 Unhandled error 且界面毫无反应
  async function setQty(dish, n) {
    try {
      if (n <= 0 && !order.value?.id) return { queued: false };   // 本来就没入车，无需删
      const o = await ensureOrder();
      // 锁必须在 ensureOrder 之后判：order.value 刚进页面时是 null，
      // 提前判会让第一次点击绕过锁定（实测确实绕过过）
      if (o.status !== 'draft') {
        return { queued: false, error: new Error(`「${o.meal_type}」已确认，先点下面的「取消点餐」再改`) };
      }
      const r = await setItemQuantity(o, dish, n);
      if (!r.error) {
        if (n <= 0) o.items = o.items.filter(i => i.dish_id !== dish.id);
        else {
          const hit = o.items.find(i => i.dish_id === dish.id);
          if (hit) hit.quantity = n;
          else o.items.push({ id: null, order_id: o.id, dish_id: dish.id, quantity: n, category: dish.category, dish });
        }
        // 删空了就把这条空草稿一起删掉，别重蹈「浏览一次留一行」的覆辙
        if (!o.items.length && o.status === 'draft') await dropOrder(o);
      }
      return r;
    } catch (e) {
      return { queued: false, error: e };
    }
  }

  async function clearAll() {
    try {
      const o = order.value;
      if (!o?.id) { order.value = emptyHead(); return { queued: false }; }
      if (o.status !== 'draft') return { queued: false, error: new Error('已经确认的一顿不能清空') };
      return await dropOrder(o);
    } catch (e) { return { queued: false, error: e }; }
  }

  async function confirm() {
    if (!order.value?.id) return { queued: false, error: new Error('还没点菜，先加一道') };
    try {
      const r = await confirmOrder(order.value);
      if (!r.error) await load();
      return r;
    } catch (e) { return { queued: false, error: e }; }
  }

  async function cancel() {
    if (!order.value?.id) return { queued: false, error: new Error('这顿还没落库') };
    try {
      const r = await cancelOrder(order.value);
      if (!r.error) await load();     // 重读而不是本地改 status：统计变了，以库为准
      return r;
    } catch (e) { return { queued: false, error: e }; }
  }

  // 挪完跟着视图走到新位置，否则用户看到的还是原来那个空槽，以为没挪成功。
  // 参数刻意叫 d / t：跟 setDate / setMealType 一致，也避免和上面那两个 ref 重名
  async function moveTo(d, t) {
    const o = order.value;
    if (!o?.id) return { queued: false, error: new Error('这顿还没落库，不用挪') };
    try {
      const r = await moveOrder(o, d, t);
      if (!r.error) { date.value = d; mealType.value = t; await load(); }
      return r;
    } catch (e) { return { queued: false, error: e }; }
  }

  async function loadHistory(limit = 30) {
    try { history.value = await recentHistory(limit); }
    catch (e) { error.value = classifyError(e); }
  }

  return { date, mealType, order, order_items: items, items, count, totalMinutes, qtyOf, isDraft, locked, canCancel,
           loading, error, history, load, setMealType, setDate, add, setQty, clearAll,
           confirm, cancel, moveTo, loadHistory };
});
