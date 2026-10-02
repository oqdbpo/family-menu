<template>
  <div>
    <div class="navbar">
      <RouterLink to="/" class="back" aria-label="返回"><Ic name="left" :size="18" /></RouterLink>
      <div class="t"><b>菜品管理</b><em>manage dishes</em></div>
      <div class="act">
        <button class="iconbtn" aria-label="刷新" :disabled="loading" title="刷新" @click="load(true)">
          <Ic name="swap" :class="{ spin: loading }" />
        </button>
      </div>
    </div>

    <div class="pad">
      <div class="search">
        <Ic name="search" />
        <input v-model="q" placeholder="搜菜名、食材、做法">
      </div>
    </div>

    <div class="pad" style="margin-top:11px">
      <RouterLink to="/family" class="card tap" style="display:flex;align-items:center;gap:12px">
        <span class="avstack">
          <span v-for="m in session.members.slice(0, 4)" :key="m.id" class="av">
            {{ (m.name || '家').trim().slice(0, 1) }}
          </span>
        </span>
        <div style="flex:1;min-width:0">
          <b style="display:block;font-size:14.5px">家庭成员</b>
          <span class="hint">{{ session.members.length }} 人 · 邀请码
            <b class="mono">{{ session.family?.invite_code || '——' }}</b> · 看看都有谁</span>
        </div>
        <Ic name="right" :size="16" />
      </RouterLink>
    </div>

    <div class="pad" style="margin-top:11px"><div class="chips nowrap">
      <button v-for="p in panels" :key="p.key" class="chip" :class="{ on: panel === p.key }" @click="panel = p.key">
        {{ p.label }} {{ counts[p.key] }}
      </button>
    </div></div>

    <div class="pad" style="margin-top:14px">
      <div class="stats">
        <div><b>{{ counts.全部 }}</b><em>启用菜品</em></div>
        <div><b>{{ counts.停用 }}</b><em>已停用</em></div>
        <div><b>{{ counts.缺图 }}</b><em>缺图片</em></div>
        <div><b>{{ staleCount }}</b><em>30 天没吃</em></div>
      </div>
    </div>

    <StateBlock v-if="loading && !rows.length" kind="loading" />

    <div class="pad" style="margin-top:18px">
      <div v-for="d in shown" :key="d.id" class="row" :style="!d.is_active ? 'opacity:.55' : null">
        <DishThumb :path="d.image_path" :style="{ width: '46px', height: '46px', borderRadius: '11px' }" />
        <div class="b">
          <b>{{ d.name }}</b>
          <em>{{ [d.meal_type, d.category, d.subcategory].filter(Boolean).join(' · ') }}
            · {{ ingredientName(d.ingredient_id) || '未填食材' }}
            + {{ methodName(d.cooking_method_id) || '未填做法' }}</em>
        </div>
        <div class="ops">
          <button class="iconbtn" aria-label="编辑" @click="edit(d)"><Ic name="edit" /></button>
          <button class="iconbtn" aria-label="删除" @click="del(d)"><Ic name="trash" class="del" /></button>
          <button class="sw2" :class="{ off: !d.is_active }" :aria-label="d.is_active ? '停用' : '启用'" @click="toggle(d)" />
        </div>
      </div>

      <StateBlock v-if="!shown.length" kind="empty" title="这里没有菜" desc="换个筛选条件，或点右下角加一道" icon="menu3" />

      <div class="banner info" style="margin-top:18px">
        <Ic name="leaf" :size="16" />
        <div><b>删除是二次确认的</b>家庭菜单是长期积累的数据，默认走「停用」而不是删除。
          有历史记录的菜数据库会直接拒绝物理删除。</div>
      </div>
      <p class="hint" style="margin-top:12px;line-height:1.9">
        <b>分类与食材是两回事</b>：西红柿炒鸡蛋归「素菜」，食材仍记「鸡蛋」。<br>
        <b>选项全部来自数据库</b>：食材 / 做法 / 标签不在前端写死。</p>
    </div>

    <button class="fab" aria-label="新增菜品" @click="create"><Ic name="plus" /></button>

    <DishForm v-model="formOpen" :dish="editing" @saved="load(true)" />

    <Teleport to="body">
      <div v-if="confirmDel" class="sheet">
        <button class="mask" @click="confirmDel = null" />
        <div class="pan" style="max-height:none">
          <div class="grab" />
          <div class="hd"><b>删除「{{ confirmDel.name }}」？</b></div>
          <p class="hint" style="margin-bottom:14px">它已经被点过 {{ confirmDel.eat_count }} 次。
            建议改成「停用」，历史记录会保留，也不会再出现在点餐列表里。</p>
          <div style="display:flex;gap:11px">
            <button class="btn o" style="flex:1" @click="confirmDisable">改为停用</button>
            <button class="btn w" style="flex:1" @click="confirmRemove">仍要删除</button>
          </div>
          <button class="btn g blk" style="margin-top:10px" @click="confirmDel = null">取消</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import Ic from '../components/Ic.vue';
import DishThumb from '../components/DishThumb.vue';
import StateBlock from '../components/StateBlock.vue';
import DishForm from '../components/DishForm.vue';
import { fetchDishes, removeDish } from '../services/dishes';
import { useDishStore, daysSince } from '../stores/dishes';
import { useSessionStore } from '../stores/session';
import { useDicts } from '../composables/useDicts';

const dishes = useDishStore();
const session = useSessionStore();
const { ingredientName, methodName } = useDicts();
const rows = ref([]);
const loading = ref(false);
const q = ref('');
const panel = ref('全部');
const formOpen = ref(false);
const editing = ref(null);
const confirmDel = ref(null);

const panels = [
  { key: '全部', label: '全部' }, { key: '缺图', label: '缺图' },
  { key: '停用', label: '停用' }, { key: '收藏', label: '收藏' },
];

async function load(force = false) {
  loading.value = true;
  try { rows.value = await fetchDishes({ includeInactive: true }); }
  finally { loading.value = false; }
  if (force) await dishes.load(true);
}

const counts = computed(() => ({
  全部: rows.value.filter(d => d.is_active).length,
  缺图: rows.value.filter(d => d.is_active && !d.image_path).length,
  停用: rows.value.filter(d => !d.is_active).length,
  收藏: rows.value.filter(d => d.is_favorite).length,
}));
const staleCount = computed(() => rows.value.filter(d => {
  const n = daysSince(d); return d.is_active && (n === null || n >= 30);
}).length);

const shown = computed(() => {
  const s = q.value.trim().toLowerCase();
  return rows.value.filter(d => {
    if (panel.value === '缺图' && (d.image_path || !d.is_active)) return false;
    if (panel.value === '停用' && d.is_active) return false;
    if (panel.value === '收藏' && !d.is_favorite) return false;
    if (panel.value === '全部' && !d.is_active) return false;
    if (s && !`${d.name} ${ingredientName(d.ingredient_id)} ${methodName(d.cooking_method_id)} ${d.category}`
      .toLowerCase().includes(s)) return false;
    return true;
  });
});

function create() { editing.value = null; formOpen.value = true; }
function edit(d) { editing.value = d; formOpen.value = true; }

async function toggle(d) {
  const next = !d.is_active;
  const r = await dishes.setActive(d, next);
  if (!r.error) d.is_active = next;
}

async function del(d) { confirmDel.value = d; }
async function confirmRemove() {
  const d = confirmDel.value; confirmDel.value = null;
  try { await removeDish(d); await load(true); }
  catch (e) { window.alert(e.friendly || e.message); }
}
async function confirmDisable() {
  const d = confirmDel.value; confirmDel.value = null;
  await toggle(d);
}

onMounted(load);
</script>
