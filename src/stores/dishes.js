import { defineStore } from 'pinia';
import { ref, reactive, computed } from 'vue';
import { fetchDishes, toggleFavorite as svcToggleFav, setActive as svcSetActive, saveDish, removeDish } from '../services/dishes';
import { onSync } from '../lib/sync';
import { classifyError } from '../config';

export const daysSince = d => (d.last_eaten_at
  ? Math.floor((Date.now() - new Date(d.last_eaten_at).getTime()) / 864e5)
  : null);

export const useDishStore = defineStore('dishes', () => {
  // 一份数据两个视角：rows 含已停用（菜品管理页要能开关），all 只看在用的（点餐/收藏/随机）
  // 之前是两次请求各拉一遍，别的设备改了菜之后这两份会新旧不一致，现在一次拉完全靠派生
  const rows = ref([]);
  const all = computed(() => rows.value.filter(d => d.is_active));
  const loading = ref(false);
  const error = ref(null);
  const loadedAt = ref(0);
  const filter = reactive({
    mealType: '正餐', category: '荤菜', subcategory: '',
    ingredientId: null, methodId: null, tag: null, search: '',
  });

  const pull = async () => {
    rows.value = await fetchDishes({ includeInactive: true });
    loadedAt.value = Date.now();
  };

  async function load(force = false) {
    if (!force && rows.value.length && Date.now() - loadedAt.value < 60_000) return;
    loading.value = true;
    error.value = null;
    try {
      await pull();
    } catch (e) {
      error.value = classifyError(e);
    } finally {
      loading.value = false;
    }
  }

  // 同步轮询走这条路：不翻 loading（列表不会闪一下），也不清 error（本机有旧数据可看）
  async function sync() {
    try {
      await pull();
      error.value = null;
    } catch (e) {
      error.value = classifyError(e);
    }
  }
  onSync(sync, 'dish');

  const inSection = computed(() => all.value.filter(d =>
    d.meal_type === filter.mealType &&
    d.category === filter.category &&
    (!filter.subcategory || d.subcategory === filter.subcategory)));

  // 左侧食材栏的计数随当前分区变化，避免点进去是空列表
  const ingredients = computed(() => {
    const m = new Map();
    for (const d of inSection.value) {
      if (!d.ingredient_id) continue;
      m.set(d.ingredient_id, (m.get(d.ingredient_id) || 0) + 1);
    }
    return [...m.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count);
  });

  const methods = computed(() => {
    const m = new Map();
    for (const d of inSection.value) {
      if (!d.cooking_method_id) continue;
      m.set(d.cooking_method_id, (m.get(d.cooking_method_id) || 0) + 1);
    }
    return [...m.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count);
  });

  const visible = computed(() => {
    const q = filter.search.trim().toLowerCase();
    return inSection.value.filter(d => {
      if (filter.ingredientId && d.ingredient_id !== filter.ingredientId) return false;
      if (filter.methodId && d.cooking_method_id !== filter.methodId) return false;
      if (filter.tag && !d.tags.some(t => t.name === filter.tag)) return false;
      if (q && !(`${d.name} ${d.description || ''}`.toLowerCase().includes(q))) return false;
      return true;
    });
  });

  const favorites = computed(() => all.value.filter(d => d.is_favorite));
  const frequent = computed(() => [...all.value].filter(d => d.eat_count > 0)
    .sort((a, b) => b.eat_count - a.eat_count));
  const stale = computed(() => all.value.filter(d => {
    const n = daysSince(d);
    return n === null || n >= 30;
  }).length);

  function setSection(mealType, category) {
    filter.mealType = mealType;
    filter.category = category;
    filter.subcategory = '';
    filter.ingredientId = null;
    filter.methodId = null;
  }

  // 收藏/停用都不再手动改本地数组：service 把新值写回 dish，而 dish 就是 rows 里的那一行，
  // all 是它的派生，改完自动重算。多设备同步替换 rows 时也不会出现两份状态对不上
  const toggleFavorite = svcToggleFav;

  const setActive = svcSetActive;

  async function save(dish, tagIds) {
    const r = await saveDish(dish, tagIds);
    if (!r.error) await load(true);
    return r;
  }

  async function remove(dish) {
    try {
      await removeDish(dish);
      await load(true);
      return { queued: false };
    } catch (e) {
      return { queued: false, error: e };
    }
  }

  return { rows, all, loading, error, filter, ingredients, methods, visible, favorites, frequent, stale,
           inSection, load, sync, setSection, toggleFavorite, setActive, save, remove };
});
