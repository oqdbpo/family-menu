<template>
  <div>
    <div class="navbar">
      <RouterLink to="/order" class="back" aria-label="返回"><Ic name="left" :size="18" /></RouterLink>
      <div class="t"><b>今日点餐</b><em>today's menu</em></div>
      <div class="act"><RouterLink to="/favorites" class="iconbtn" aria-label="点餐历史"><Ic name="book" /></RouterLink></div>
    </div>

    <div class="datebar">
      <div class="d">
        <b>{{ prettyDate }}</b><em>{{ weekday }}</em>
        <input class="dateshim" type="date" :min="todayStr" :value="order.date"
               aria-label="选择日期" @change="pickDate">
      </div>
      <button v-if="!isToday" class="btn xs g" @click="jump(todayStr)">回到今天</button>
      <div style="margin-left:auto;display:flex;gap:6px">
        <button class="iconbtn" style="width:28px;height:28px" aria-label="前一天" @click="shift(-1)"><Ic name="left" :size="14" /></button>
        <button class="iconbtn" style="width:28px;height:28px" aria-label="后一天" @click="shift(1)"><Ic name="right" :size="14" /></button>
      </div>
    </div>

    <div style="margin:0 18px 14px">
      <Seg :model-value="order.mealType" :options="mealTypes" @update:model-value="order.setMealType" />
    </div>

    <div class="pad">
      <div class="card" style="padding:13px 15px">
        <div style="display:flex;align-items:center;gap:11px">
          <div class="avstack"><span v-for="m in session.members" :key="m.id" class="av">{{ m.name.slice(0, 1) }}</span></div>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:700">{{ session.members.length }} 人 · {{ order.isDraft ? '还在草稿' : '已确认' }}</div>
            <div class="hint" style="font-size:11px;margin-top:1px">{{ order.count }} 道菜 · 并行约 {{ order.totalMinutes }} 分钟</div>
          </div>
          <RouterLink to="/dishes" class="btn xs o">管理菜品</RouterLink>
        </div>
      </div>
    </div>

    <div v-if="order.locked" class="pad"><div class="banner info" style="margin-top:10px">
      <Ic name="check" :size="16" /><div><b>「{{ order.mealType }}」已确认</b>
        {{ order.canCancel ? '点右下角「取消点餐」就能退回草稿：删菜、换餐次、改日期都可以。吃过的顿才是不能动的历史。'
                            : '这一顿是吃过的历史，不能改。要挪菜请点别的日期。' }}</div>
    </div></div>

    <div v-if="notice" class="pad"><div class="banner warn" style="margin-top:10px">
      <Ic name="clock" :size="16" /><div>{{ notice }}</div>
    </div></div>

    <StateBlock v-if="order.loading && !order.order" kind="loading" />
    <StateBlock v-else-if="!order.count" kind="empty" :image="emptyArt" title="这顿还没点菜"
                :desc="isFuture ? '提前把这顿安排好，到时候直接照着做' : '去点餐页挑，或者摇一个'">
      <RouterLink to="/order" class="btn p sm">我要点餐</RouterLink>
    </StateBlock>

    <template v-else>
      <template v-for="g in groups" :key="g.name">
        <div class="grp">
          <b>{{ g.name }}</b><em>× {{ g.items.length }}</em><span class="dash" />
          <RouterLink to="/order" class="btn xs g">+ 加</RouterLink>
        </div>
        <div class="pad">
          <DishCard v-for="i in g.items" :key="i.dish_id" :dish="i.dish" :qty="i.quantity"
                    :readonly="order.locked" :locked="order.locked"
                    can-vote show-steps :my-vote="tasteOf(i.dish_id)" @vote="p => cast(i.dish, p)"
                    @inc="order.setQty(i.dish, i.quantity + 1)" @dec="order.setQty(i.dish, i.quantity - 1)"
                    @add="order.setQty(i.dish, i.quantity + 1)" @remove="order.setQty(i.dish, 0)" />
        </div>
      </template>

      <div v-if="order.isDraft && order.order?.id && order.count" class="pad" style="margin-top:12px">
        <div class="card" style="padding:12px 14px">
          <button class="btn xs g blk" style="justify-content:center" @click="toggleMove">
            <Ic name="swap" :size="13" />{{ moveOpen ? '收起「挪这顿」' : '这顿挪到别的餐次 / 日期' }}
          </button>
          <div v-if="moveOpen" style="margin-top:13px">
            <div class="hint" style="margin-bottom:6px">餐次</div>
            <div class="chips">
              <button v-for="t in mealTypes" :key="t" type="button" class="chip"
                      :class="{ on: t === toMeal }" @click="toMeal = t">{{ t }}</button>
            </div>
            <div class="hint" style="margin:11px 0 6px">日期 · 今天及以后</div>
            <input v-model="toDate" type="date" :min="todayStr" class="inp mono" style="height:34px;padding:0 10px">
            <div class="hint" style="margin-top:11px">目标位置已经有别的一顿时会说清楚是哪一顿，不会偷偷合并。</div>
            <button class="btn p sm blk" style="margin-top:10px" :disabled="busy || unchanged" @click="doMove">
              <Ic name="check" :size="14" />{{ unchanged ? '选个新的餐次或日期' : '挪过去' }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="order.isDraft && order.count" class="pad" style="margin-top:16px">
        <button class="btn o sm blk" :style="armed ? 'color:var(--danger);box-shadow:inset 0 0 0 1.5px var(--danger)' : ''"
                @click="clear">
          <Ic :name="armed ? 'x' : 'trash'" :size="14" />{{ armed ? '再点一次确认清空' : '清空这顿' }}
        </button>
      </div>

      <div class="hand" style="text-align:center;font-size:16px;padding:16px 0 4px">{{ greeting }}</div>
    </template>

    <div class="dock">
      <div class="sum"><b>{{ order.isDraft ? '草稿 · 未确认' : '已确认' }}</b>
        <em>{{ order.isDraft ? '确认后写入历史 · eat_count +1' : (order.canCancel ? '点右下角可退回草稿' : '吃过的顿是历史') }}</em></div>
      <RouterLink to="/random" class="iconbtn" style="width:42px;height:42px" aria-label="随机换一道"><Ic name="dice" /></RouterLink>
      <button v-if="order.isDraft" class="btn p" :disabled="!order.count || busy" @click="confirm">
        <Ic name="check" />{{ busy ? '提交中…' : '确认点餐' }}
      </button>
      <button v-else-if="order.canCancel" class="btn o" :disabled="busy" @click="cancel">
        <Ic name="x" />{{ busy ? '处理中…' : '取消点餐' }}
      </button>
      <button v-else class="btn g" disabled>已吃过</button>
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
import { useOrderStore } from '../stores/orders';
import { MEAL_TYPES, todayISO } from '../services/orders';
import { vote, myTasteMap } from '../services/family';
import emptyArt from '../assets/img/hero-empty.png';

const session = useSessionStore();
const order = useOrderStore();
const busy = ref(false);
// 我的口味票：{ 菜id: -1|0|1 }。pref=0 是"一般"这个有效值而不是"没投过"，
// 所以取值一律用 ?? 判断，不能用 || 或真值判断
const taste = ref({});
const tasteOf = id => taste.value[id] ?? null;

const mealTypes = MEAL_TYPES;
const todayStr = todayISO();
const dayGap = computed(() => Math.round(
  (new Date(order.date + 'T00:00:00') - new Date(todayStr + 'T00:00:00')) / 864e5));
const isToday = computed(() => dayGap.value === 0);
const isFuture = computed(() => dayGap.value > 0);
const prettyDate = computed(() => {
  const [, m, d] = order.date.split('-');
  return `${Number(m)} 月 ${Number(d)} 日`;
});
const weekday = computed(() => {
  const w = '日一二三四五六'[new Date(order.date + 'T00:00:00').getDay()];
  const g = dayGap.value;
  const rel = g === 0 ? '今天' : g === 1 ? '明天' : g === 2 ? '后天' : g > 0 ? `${g} 天后` : `${-g} 天前`;
  return `星期${w} · ${rel}`;
});
const greeting = computed(() => ({ 早餐: 'breakfast for three', 午餐: 'lunch at home', 晚餐: 'dinner for three' }[order.mealType] || 'a good meal'));

const ORDER = ['荤菜', '素菜', '汤', '主食', '火锅', '其他'];
const groups = computed(() => {
  const m = new Map();
  for (const i of order.items) {
    const k = i.dish?.category || i.category || '其他';
    (m.get(k) || m.set(k, []).get(k)).push(i);
  }
  return [...m.entries()].sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0])).map(([name, items]) => ({ name, items }));
});

const notice = ref('');
const armed = ref(false);
let armTimer = null;

// 两段式确认：清空是可撤销成本最低但最容易误触的操作，不值得弹模态
async function clear() {
  if (!armed.value) {
    armed.value = true;
    clearTimeout(armTimer);
    armTimer = setTimeout(() => { armed.value = false; }, 4000);
    return;
  }
  armed.value = false;
  clearTimeout(armTimer);
  const r = await order.clearAll();
  if (r.error) notice.value = r.error.message || String(r.error);
  else if (r.queued) notice.value = '现在没网，清空操作已存在本机，联网后自动执行';
}

async function shift(n) {
  const d = new Date(order.date + 'T00:00:00');
  d.setDate(d.getDate() + n);
  await order.setDate(todayISO(d));
}
async function jump(d) { if (d) await order.setDate(d); }
async function pickDate(e) { await jump(e.target.value); }

async function confirm() {
  busy.value = true; notice.value = '';
  const r = await order.confirm();
  busy.value = false;
  if (r.error) notice.value = r.error.message || String(r.error);
  else if (r.queued) notice.value = '现在没网，确认操作已存在本机，联网后自动提交';
}

async function cancel() {
  busy.value = true; notice.value = '';
  const r = await order.cancel();
  busy.value = false;
  if (r.error) notice.value = r.error.message || String(r.error);
  else if (r.queued) notice.value = '现在没网，取消操作已存在本机，联网后自动执行';
}

// 挪这一顿。默认展开时回填当前所在位置，这样"没改任何东西"时按钮是灰的，
// 不会出现点一下挪到它本来就在的地方
const moveOpen = ref(false);
const toMeal = ref('');
const toDate = ref('');
const unchanged = computed(() => toMeal.value === order.order?.meal_type && toDate.value === order.order?.meal_date);

function toggleMove() {
  moveOpen.value = !moveOpen.value;
  if (moveOpen.value) { toMeal.value = order.order?.meal_type; toDate.value = order.order?.meal_date; }
}

async function doMove() {
  busy.value = true; notice.value = '';
  const r = await order.moveTo(toDate.value, toMeal.value);
  busy.value = false;
  if (r.error) { notice.value = r.error.message || String(r.error); return; }
  moveOpen.value = false;
  notice.value = r.queued ? '现在没网，挪动已存在本机，联网后自动执行'
                          : `已挪到 ${toDate.value} · ${toMeal.value}`;
}

async function cast(dish, p) {
  const prev = taste.value[dish.id] ?? null;
  // 先改本地再发请求：饭桌上手指连点好几道，等请求回来才亮会让人觉得没点上
  taste.value = { ...taste.value, [dish.id]: p };
  notice.value = '';
  const r = await vote(dish.id, p);
  if (r.error) {
    // 写失败就把图标退回原样，别留一个"看着标上了其实没进库"的状态
    taste.value = { ...taste.value, [dish.id]: prev };
    notice.value = r.error.message || String(r.error);
  } else if (r.queued) {
    notice.value = `「${dish.name}」的口味已存在本机，联网后自动上传`;
  }
}

onMounted(async () => {
  await order.load();
  // 一次把全家的票拉成 map，而不是逐道菜各查一次
  taste.value = await myTasteMap().catch(() => ({}));
});
</script>
