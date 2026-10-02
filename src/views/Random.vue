<template>
  <div>
    <div class="navbar">
      <RouterLink to="/" class="back" aria-label="返回"><Ic name="left" :size="18" /></RouterLink>
      <div class="t"><b>随机吃什么</b><em>roll the dice</em></div>
    </div>

    <img :src="hero" alt="" style="width:220px;margin:-2px auto 6px">

    <div style="margin:0 18px 14px">
      <Seg v-model="mode" warm :options="[{ value: 'one', label: '随机一道' }, { value: 'side', label: '随机配菜' }, { value: 'table', label: '随机一桌' }]" />
    </div>

    <div class="pad">
      <div class="card" style="padding:14px 16px">
        <div style="display:grid;gap:11px">
          <div class="frow">
            <span class="flbl">餐型</span>
            <div class="chips"><button v-for="m in ['正餐','早餐']" :key="m" class="chip" :class="{ on: f.mealType === m }" @click="f.mealType = m">{{ m }}</button></div>
          </div>
          <div class="frow">
            <span class="flbl">类别</span>
            <div class="chips">
              <button class="chip" :class="{ on: !f.category }" @click="f.category = null">不限</button>
              <button v-for="c in categories" :key="c" class="chip" :class="{ on: f.category === c }" @click="f.category = c">{{ c }}</button>
            </div>
          </div>
          <div class="frow">
            <span class="flbl">口味</span>
            <div class="chips">
              <button v-for="t in tasteTags" :key="t.name" class="chip" :class="{ on: f.tag === t.name }" @click="f.tag = f.tag === t.name ? null : t.name">{{ t.name }}</button>
            </div>
          </div>
        </div>
        <div v-if="mode === 'table'" class="frow" style="margin-top:11px">
          <span class="flbl">人数</span>
          <div class="chips"><button v-for="n in [2, 3, 5]" :key="n" class="chip" :class="{ on: f.people === n }" @click="f.people = n">{{ n }} 人</button></div>
        </div>
      </div>
    </div>

    <button class="dice-btn" :class="{ rolling }" :disabled="busy" style="margin-top:16px" @click="roll">
      <span style="display:grid;justify-items:center">
        <Ic name="dice" :style="{ stroke: '#fff' }" />
        <b>{{ busy ? '摇动中' : '摇一摇' }}</b>
      </span>
    </button>
    <div class="hint" style="text-align:center;margin:10px 0 16px">
      权重按 久没吃 / 历史频次 / 近期 / 收藏 / 全家偏好 / 荤素平衡 六项算
    </div>

    <div class="pad">
      <div v-if="err" class="banner err"><Ic name="x" :size="16" /><div><b>摇不出来</b>{{ err }}</div></div>

      <!-- 随机一桌 -->
      <div v-if="mode === 'table' && table.length" class="card" style="padding:14px 16px">
        <div style="display:grid;gap:10px">
          <div v-for="row in table" :key="row.dish_id" style="display:flex;align-items:center;gap:10px">
            <span class="tag" style="width:38px;text-align:center">{{ row.category.slice(0, 2) }}</span>
            <DishThumb :path="row.image_path" :url="row.url" :style="{ width: '38px', height: '38px', borderRadius: '10px' }" />
            <b style="font-size:13.5px;flex:1;min-width:0">{{ row.dish_name }}</b>
            <span class="hint" style="font-size:11px">{{ row.cooking_time }} min</span>
            <button class="add mini" @click="take(row)"><Ic name="plus" :size="14" /></button>
          </div>
        </div>
        <div class="hint" style="margin-top:12px;padding-top:11px;border-top:1px dashed var(--line)">
          并行烹饪约 {{ tableMinutes }} 分钟 · 一桌菜按 table_plan 表配置，改表就能改规则</div>
        <button class="btn w blk" style="margin-top:12px" @click="takeAll"><Ic name="check" />整桌加进今日点餐</button>
      </div>

      <!-- 随机一道 / 配菜 -->
      <div v-for="r in results" :key="r.dish_id" class="result" style="margin-bottom:12px">
        <div style="display:flex;gap:13px;align-items:center">
          <DishThumb :path="r.image_path" :url="r.url" :style="{ width: '74px', height: '74px' }" />
          <div style="flex:1;min-width:0">
            <div style="font-size:19px;font-weight:800;letter-spacing:-.3px">{{ r.dish_name }}</div>
            <div class="hint" style="font-size:11.5px;margin-top:2px">{{ r.category }} · {{ r.days_since >= 999 ? '从没点过' : r.days_since + ' 天前吃过' }}</div>
            <div class="tags" style="margin-top:7px">
              <span v-for="t in (r.dish?.tags || []).slice(0, 3)" :key="t.name" :class="tagClass(t)">{{ t.name }}</span>
            </div>
          </div>
        </div>
        <div class="why">
          <div v-for="w in r.reasons" :key="w.key">
            <Ic name="leaf" :size="13" /><span class="lbl">{{ w.label }}</span>
            <span class="bar" :class="barClass(w)"><i :style="{ width: Math.round(w.weight * 100) + '%' }" /></span>
            <span style="font-size:11px;white-space:nowrap">{{ w.detail }}</span>
          </div>
        </div>
        <div style="display:flex;gap:10px;margin-top:15px">
          <button class="btn o" style="flex:1" @click="roll"><Ic name="swap" />换一个</button>
          <button class="btn w" style="flex:1.2" @click="take(r)"><Ic name="check" />就吃它</button>
        </div>
      </div>

      <StateBlock v-if="!results.length && !table.length && !err" kind="empty" title="摇一下就知道"
                  desc="不是等概率随机——最近吃过的会被压权重，很久没吃的会被抬上来" icon="dice" />
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import Ic from '../components/Ic.vue';
import Seg from '../components/Seg.vue';
import DishThumb from '../components/DishThumb.vue';
import StateBlock from '../components/StateBlock.vue';
import { useSessionStore } from '../stores/session';
import { useDishStore } from '../stores/dishes';
import { useOrderStore } from '../stores/orders';
import { randomDish, randomTable } from '../services/random';
import { publicImageUrl } from '../lib/supabase';
import { tagClass } from '../composables/useDicts';
import { classifyError } from '../config';
import hero from '../assets/img/hero-random.png';

const session = useSessionStore();
const dishes = useDishStore();
const order = useOrderStore();
const router = useRouter();

const mode = ref('one');
const f = reactive({ mealType: '正餐', category: null, tag: null, people: 3 });
const results = ref([]);
const table = ref([]);
const busy = ref(false);
const rolling = ref(false);
const err = ref('');

const categories = computed(() => [...new Set((session.dicts?.categoryList || [])
  .filter(c => c.meal_type === f.mealType).map(c => c.category))]);
const tasteTags = computed(() => (session.dicts?.tags || []).filter(t => t.kind === '口味'));
const tableMinutes = computed(() => Math.max(0, ...table.value.map(r => r.cooking_time || 0)));

async function roll() {
  busy.value = true; err.value = ''; rolling.value = true;
  setTimeout(() => { rolling.value = false; }, 640);
  try {
    await dishes.load();
    const byId = new Map(dishes.all.map(d => [d.id, d]));
    if (mode.value === 'table') {
      table.value = (await randomTable(f.people, f.mealType)).map(r => ({
        ...r, dish: byId.get(r.dish_id), url: publicImageUrl(byId.get(r.dish_id)?.image_path),
      }));
      results.value = [];
    } else {
      const n = mode.value === 'side' ? 3 : 1;
      results.value = (await randomDish({ mealType: f.mealType, category: f.category, tag: f.tag, limit: n }))
        .map(r => ({ ...r, dish: byId.get(r.dish_id), url: publicImageUrl(byId.get(r.dish_id)?.image_path) }));
      table.value = [];
    }
    if (!results.value.length && !table.value.length) err.value = '符合这些条件的菜还没有，放宽一点再摇';
  } catch (e) {
    const k = classifyError(e);
    err.value = k === 'offline' ? '连不上服务器，等网络恢复再摇' : (e.message || String(e));
  } finally { busy.value = false; }
}

async function take(r) {
  const d = dishes.all.find(x => x.id === r.dish_id);
  if (!d) return;
  const res = await order.add(d);
  if (res.error) err.value = res.error.message;
  else router.push('/today');
}

async function takeAll() {
  for (const row of table.value) {
    const d = dishes.all.find(x => x.id === row.dish_id);
    if (d) await order.add(d);
  }
  router.push('/today');
}

const barClass = w => ({ stale: 'y', freq: 'y', recent: 't', pref: 'm', balance: '', fav: '' }[w.key] || '');
</script>

<style scoped>
.frow { display: flex; align-items: center; gap: 9px }
.flbl { font-size: 11px; color: var(--ink-3); width: 34px; flex: 0 0 auto }
.add.mini { width: 26px; height: 26px }
.add.mini svg { width: 14px; height: 14px }
</style>
