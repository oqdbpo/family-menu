<template>
  <div>
    <div class="navbar">
      <RouterLink to="/" class="back" aria-label="返回"><Ic name="left" :size="18" /></RouterLink>
      <div class="t"><b>{{ tab === '收藏' ? '我的收藏' : '我的常吃' }}</b><em>{{ tab === '收藏' ? 'favorites' : 'most eaten' }}</em></div>
    </div>

    <div style="margin:0 18px 12px">
      <Seg v-model="tab" :options="[{ value: '收藏', label: `收藏 ${dishes.favorites.length}` }, { value: '常吃', label: `常吃 ${dishes.frequent.length}` }]" />
    </div>

    <StateBlock v-if="dishes.loading && !dishes.all.length" kind="loading" />

    <template v-else>
      <div class="pad">
        <div class="net">
          <RouterLink v-for="d in list" :key="d.id" to="/order" class="c">
            <DishThumb :path="d.image_path" class="thg" :style="{ width: '100%' }" />
            <span v-if="tab === '常吃'" class="badge">{{ d.eat_count }} 次</span>
            <span v-else class="badge m">收藏</span>
            <div class="n">{{ d.name }}</div>
            <div class="s">{{ sub(d) }}</div>
          </RouterLink>
        </div>
      </div>

      <template v-if="tab === '常吃' && dishes.frequent.length">
        <div class="sec-t"><b style="font-size:13.5px">常吃榜</b><em>ranked</em></div>
        <div class="pad">
          <div class="card" style="padding:14px 16px;display:grid;gap:11px">
            <div v-for="(d, i) in dishes.frequent.slice(0, 5)" :key="d.id" style="display:flex;align-items:center;gap:10px">
              <b style="font-size:12px;width:14px;color:var(--ink-3)">{{ i + 1 }}</b>
              <span style="font-size:13px;font-weight:700;flex:0 0 84px">{{ d.name }}</span>
              <span class="bar y"><i :style="{ width: pct(d.eat_count) + '%' }" /></span>
              <span class="mono" style="font-size:11px;color:var(--ink-3)">{{ d.eat_count }}</span>
            </div>
            <div v-for="d in rarely" :key="'r' + d.id" style="display:flex;align-items:center;gap:10px">
              <b style="font-size:12px;width:14px;color:var(--olive)">↑</b>
              <span style="font-size:13px;font-weight:700;flex:0 0 84px;color:var(--olive-deep)">{{ d.name }}</span>
              <span class="bar t"><i style="width:14%" /></span>
              <span class="mono" style="font-size:11px;color:var(--ink-3)">{{ d.eat_count }}</span>
            </div>
            <p class="hint" style="padding-top:3px">末行是<b>低频但很久没吃</b>的菜，随机算法会主动把它们往上抬。</p>
          </div>
        </div>
      </template>

      <StateBlock v-if="!list.length" :image="emptyArt"
                  :title="tab === '收藏' ? '还没有收藏' : '还没有点餐记录'"
                  :desc="tab === '收藏' ? '在菜品卡片上点心形就能收藏' : '点一顿，这里就有内容了'">
        <RouterLink to="/order" class="btn p sm">去点餐页看看</RouterLink>
      </StateBlock>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import Ic from '../components/Ic.vue';
import Seg from '../components/Seg.vue';
import DishThumb from '../components/DishThumb.vue';
import StateBlock from '../components/StateBlock.vue';
import { useDishStore, daysSince } from '../stores/dishes';
import { useDicts } from '../composables/useDicts';
import emptyArt from '../assets/img/hero-empty.png';

const dishes = useDishStore();
const { ingredientName, methodName } = useDicts();
const tab = ref('收藏');

const list = computed(() => (tab.value === '收藏' ? dishes.favorites : dishes.frequent));
const maxEat = computed(() => Math.max(1, ...dishes.frequent.map(d => d.eat_count)));
const pct = n => Math.round((n / maxEat.value) * 100);
const rarely = computed(() => dishes.frequent.filter(d => d.eat_count <= 2).slice(0, 2));

const sub = d => {
  const n = daysSince(d);
  const head = [ingredientName(d.ingredient_id), methodName(d.cooking_method_id)].filter(Boolean).join('+') || d.category;
  return n === null ? head : `${head} · ${n} 天前`;
};

onMounted(() => dishes.load());
</script>
