<template>
  <div>
    <div class="navbar">
      <RouterLink to="/" class="back" aria-label="返回"><Ic name="left" :size="18" /></RouterLink>
      <div class="t"><b>我要点餐</b><em>order your meal</em></div>
      <div class="act">
        <button class="iconbtn" :class="{ on: showSearch }" aria-label="搜索" @click="showSearch = !showSearch">
          <Ic name="search" />
        </button>
      </div>
    </div>

    <div style="margin:0 18px 12px">
      <Seg :model-value="dishes.filter.mealType" :options="mealTypes" @update:model-value="pickMeal" />
    </div>

    <div class="pad"><div class="chips">
      <button v-for="c in categories" :key="c" class="chip" :class="{ on: dishes.filter.category === c }"
              @click="dishes.setSection(dishes.filter.mealType, c)">{{ c }}</button>
    </div></div>

    <div v-if="subcategories.length" class="pad" style="margin-top:10px"><div class="chips nowrap">
      <button class="chip" :class="{ on: !dishes.filter.subcategory }"
              @click="dishes.filter.subcategory = ''">全部</button>
      <button v-for="s in subcategories" :key="s" class="chip" :class="{ on: dishes.filter.subcategory === s }"
              @click="dishes.filter.subcategory = s">{{ s }}</button>
    </div></div>

    <div v-if="showSearch" class="pad" style="margin-top:12px">
      <div class="search">
        <Ic name="search" />
        <input v-model="dishes.filter.search" placeholder="搜菜名、备注">
        <button v-if="dishes.filter.search" class="fil iconbtn" @click="dishes.filter.search = ''"><Ic name="x" /></button>
      </div>
    </div>

    <StateBlock v-if="dishes.loading && !dishes.all.length" kind="loading" />
    <StateBlock v-else-if="dishes.error" :kind="stateKind" :cached="dishes.all.length" @retry="dishes.load(true)" />

    <div v-else class="twocol" style="margin-top:14px">
      <div class="side">
        <button class="chip" style="height:auto;padding:6px 4px;box-shadow:none;background:none"
                :class="{ on: !dishes.filter.ingredientId }" @click="dishes.filter.ingredientId = null">
          全部<span class="c">{{ dishes.inSection.length }}</span>
        </button>
        <button v-for="g in dishes.ingredients" :key="g.id" :class="{ on: dishes.filter.ingredientId === g.id }"
                @click="dishes.filter.ingredientId = g.id">
          {{ ingredientName(g.id) }}<span class="c">{{ g.count }}</span>
        </button>
      </div>

      <div class="maincol">
        <div class="micro" style="margin-bottom:7px">method · 做法</div>
        <div class="chips nowrap">
          <button class="chip" :class="{ on: !dishes.filter.methodId }" @click="dishes.filter.methodId = null">不限</button>
          <button v-for="m in dishes.methods" :key="m.id" class="chip warm" :class="{ on: dishes.filter.methodId === m.id }"
                  @click="dishes.filter.methodId = m.id">{{ methodName(m.id) }}</button>
        </div>

        <div class="hint" style="margin:10px 0 8px">{{ sectionLabel }} · {{ dishes.visible.length }} 道</div>

        <div v-if="order.locked || notice" class="banner warn" style="margin-bottom:10px">
          <Ic name="clock" :size="16" />
          <div><b v-if="order.locked">「{{ order.mealType }}」已经确认过了</b>
            {{ notice || '这一顿是历史，不能再加菜。换个餐次或日期就能继续点。' }}</div>
        </div>

        <DishCard v-for="d in dishes.visible" :key="d.id" :dish="d" :qty="order.qtyOf(d.id)"
                  :locked="order.locked"
                  @add="tryAdd(d)" @inc="order.setQty(d, order.qtyOf(d.id) + 1)"
                  @dec="order.setQty(d, order.qtyOf(d.id) - 1)" @remove="order.setQty(d, 0)" />

        <StateBlock v-if="!dishes.visible.length" title="这个组合下没有菜"
                    desc="换个食材或做法试试，也可以去菜品管理里加一道" icon="leaf" />
      </div>
    </div>

    <div class="dock">
      <div class="sum"><b>已选 {{ order.count }} 道</b><em>{{ cartLabel }}</em></div>
      <RouterLink v-if="order.count" to="/today" class="btn w">去今日点餐</RouterLink>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import Ic from '../components/Ic.vue';
import Seg from '../components/Seg.vue';
import DishCard from '../components/DishCard.vue';
import StateBlock from '../components/StateBlock.vue';
import { useSessionStore } from '../stores/session';
import { useDishStore } from '../stores/dishes';
import { useOrderStore } from '../stores/orders';
import { useDicts } from '../composables/useDicts';

const session = useSessionStore();
const dishes = useDishStore();
const order = useOrderStore();
const { ingredientName, methodName } = useDicts();
const showSearch = ref(Boolean(dishes.filter.search));
const notice = ref('');
let noticeTimer = null;

async function tryAdd(d) {
  notice.value = '';
  const r = await order.add(d);
  if (r.error) {
    notice.value = r.error.message || String(r.error);
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice.value = ''; }, 4000);
  }
}

const mealTypes = computed(() => Object.keys(session.dicts?.categories || { 早餐: 1, 正餐: 1 }));
const categories = computed(() => [...new Set((session.dicts?.categoryList || [])
  .filter(c => c.meal_type === dishes.filter.mealType).map(c => c.category))]);
const subcategories = computed(() => (session.dicts?.categoryList || [])
  .filter(c => c.meal_type === dishes.filter.mealType && c.category === dishes.filter.category && c.subcategory)
  .map(c => c.subcategory));

function pickMeal(m) {
  dishes.filter.mealType = m;
  const first = [...new Set((session.dicts?.categoryList || []).filter(c => c.meal_type === m).map(c => c.category))][0];
  dishes.setSection(m, first || '其他');
}

const sectionLabel = computed(() => [dishes.filter.mealType, dishes.filter.category, dishes.filter.subcategory]
  .filter(Boolean).join(' · '));
const cartLabel = computed(() => {
  const it = order.items;
  if (!it.length) return '还没选，点右边的加号';
  return it.slice(0, 2).map(i => `${i.dish?.name} ×${i.quantity}`).join(' · ') + (it.length > 2 ? ` 等 ${it.length} 道` : '');
});
const stateKind = computed(() => (!session.online ? 'offline' : dishes.error === 'offline' ? 'waking' : 'error'));

onMounted(() => { dishes.load(); order.load(); });
</script>
