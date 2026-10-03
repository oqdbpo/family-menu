<template>
  <div class="dish" :style="dim ? 'opacity:.55' : null">
    <DishThumb :path="dish.image_path" :alt="dish.name" />
    <div class="b">
      <div class="nm">
        <b>{{ dish.name }}</b>
        <Ic v-if="dish.is_favorite" name="heart" :size="15" :style="{ fill: 'var(--mauve)', stroke: 'none' }" />
      </div>
      <div class="meta">{{ meta }}</div>
      <div class="tags">
        <span v-for="t in dish.tags.slice(0, 3)" :key="t.name" :class="tagClass(t)">{{ t.name }}</span>
        <span v-if="stale" class="tag off">{{ stale }} 天没吃</span>
      </div>
      <!-- 口味票直接跟在菜名下面，不再单独做一张评价卡：
           今日点餐里一桌十几道，逐道都要能标，集中一张卡就得先选菜再滚回去标 -->
      <div v-if="canVote" class="taste" role="group" :aria-label="`这道菜在我家的口味`">
        <button v-for="v in TASTES" :key="v.p" type="button" :class="[v.cls, { on: myVote === v.p }]"
                :aria-pressed="myVote === v.p" :aria-label="`${dish.name}：${v.label}`" :title="v.label"
                @click="$emit('vote', v.p)">
          <Ic :name="v.icon" />
        </button>
      </div>
    </div>
    <div class="rt">
      <span v-if="readonly && qty > 0" class="tag freq" style="font-size:12px;padding:4px 10px">× {{ qty }}</span>
      <template v-else-if="qty > 0">
        <div class="stepper">
          <button aria-label="减少" @click="$emit('dec')"><Ic name="minus" :size="13" /></button>
          <span>{{ qty }}</span>
          <button aria-label="增加" @click="$emit('inc')"><Ic name="plus" :size="13" /></button>
        </div>
        <button class="rm" :aria-label="`把${dish.name}移出这顿`" @click="$emit('remove')">
          <Ic name="x" :size="11" />
        </button>
      </template>
      <button v-else class="add" :disabled="locked" :aria-label="`把${dish.name}加进今日点餐`" @click="$emit('add')">
        <Ic name="plus" />
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import Ic from './Ic.vue';
import DishThumb from './DishThumb.vue';
import { useDicts, tagClass } from '../composables/useDicts';
import { daysSince } from '../stores/dishes';

const props = defineProps({
  dish: { type: Object, required: true },
  qty: { type: Number, default: 0 },
  dim: Boolean,
  locked: Boolean,          // 这一餐已确认，加号只看不点
  readonly: Boolean,        // 已确认的订单：显示 ×N 而不是编辑控件
  canVote: Boolean,         // 今日点餐页才给口味票
  myVote: { type: Number, default: null },   // -1 / 0 / 1，null = 还没标过
});
defineEmits(['add', 'inc', 'dec', 'remove', 'vote']);

// p 的取值必须和 member_dish_preferences 的 check (pref in (-1,0,1)) 对齐。
// 文案按「偏好 / 一般 / 忌口」，不再是原来那张卡上的「喜欢 / 不喜欢」
const TASTES = [
  { p: 1, label: '偏好', icon: 'heart', cls: 'like' },
  { p: 0, label: '一般', icon: 'leaf', cls: 'meh' },
  { p: -1, label: '忌口', icon: 'x', cls: 'no' },
];

const { ingredientName, methodName } = useDicts();
const meta = computed(() => {
  const d = props.dish;
  const ing = ingredientName(d.ingredient_id);
  const mth = methodName(d.cooking_method_id);
  const head = [ing, mth].filter(Boolean).join(' + ') || d.category;
  const n = daysSince(d);
  return `${head} · ${d.cooking_time} min · ${n === null ? '从没点过' : n === 0 ? '今天刚吃过' : n + ' 天前吃过'}`;
});
const stale = computed(() => {
  const n = daysSince(props.dish);
  return n !== null && n >= 30 ? n : null;
});
</script>
