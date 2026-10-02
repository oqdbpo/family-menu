import { defineStore } from 'pinia';
import { ref, reactive, computed } from 'vue';
import { fetchDishes, toggleFavorite as svcToggleFav, setActive as svcSetActive, saveDish, removeDish } from '../services/dishes';
import { classifyError } from '../config';

export const daysSince = d => (d.last_eaten_at
  ? Math.floor((Date.now() - new Date(d.last_eaten_at).getTime()) / 864e5)
  : null);

export const useDishStore = defineStore('dishes', () => {
  const all = ref([]);
  const loading = ref(false);
  const error = ref(null);
  const loadedAt = ref(0);
  const filter = reactive({
    mealType: '正餐', category: '荤菜', subcategory: '',
    ingredientId: null, methodId: null, tag: null, search: '',
  });

  async function load(force = false) {
    if (!force && all.value.length && Date.now() - loadedAt.value < 60_000) return;
    loading.value = true;
    error.value = null;
    try {
      all.value = await fetchDishes();
      loadedAt.value = Date.now();
    } catch (e) {
      error.value = classifyError(e);
    } finally {
      loading.value = false;
    }
  }

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

  async function toggleFavorite(dish) {
    const r = await svcToggleFav(dish);
    if (!r.error) { const hit = all.value.find(d => d.id === dish.id); if (hit) hit.is_favorite = dish.is_favorite; }
    return r;
  }

  async function setActive(dish, next) {
    const value = next ?? !dish.is_active;
    const r = await svcSetActive(dish, value);
    if (!r.error) {
      const i = all.value.findIndex(d => d.id === dish.id);
      if (i >= 0 && !value) all.value.splice(i, 1);   // 停用即离开点餐列表
    }
    return r;
  }

  async function save(dish, tagIds) {
    const r = await saveDish(dish, tagIds);
    if (!r.error) await load(true);
    return r;
  }

  async function remove(dish) {
    const r = await removeDish(dish);
    if (!r.error) await load(true);
    return r;
  }

  return { all, loading, error, filter, ingredients, methods, visible, favorites, frequent, stale,
           inSection, load, setSection, toggleFavorite, setActive, save, remove };
});
