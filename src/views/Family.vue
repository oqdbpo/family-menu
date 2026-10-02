<template>
  <div>
    <div class="navbar">
      <RouterLink to="/dishes" class="back" aria-label="返回"><Ic name="left" :size="18" /></RouterLink>
      <div class="t"><b>家庭成员</b><em>who eats here</em></div>
      <div class="act">
        <button class="iconbtn" aria-label="刷新" :disabled="loading" @click="load(true)">
          <Ic name="swap" :class="{ spin: loading }" />
        </button>
      </div>
    </div>

    <div class="pad">
      <div class="card" style="display:flex;align-items:center;gap:12px">
        <span class="avstack">
          <span v-for="m in rows.slice(0, 4)" :key="m.id" class="av" :class="{ lv: !m.bound }">
            {{ initial(m.name) }}
          </span>
        </span>
        <div style="flex:1;min-width:0">
          <b style="display:block;font-size:14.5px">{{ session.family?.name || '我的家' }}</b>
          <span class="hint">
            {{ rows.length }} 人 · 邀请码 <b class="mono">{{ code }}</b>
          </span>
        </div>
      </div>
    </div>

    <StateBlock v-if="loading && !rows.length" kind="loading" />

    <div class="pad" style="margin-top:16px">
      <div v-for="m in rows" :key="m.id" class="row">
        <span class="av" :class="{ lv: !m.bound }">{{ initial(m.name) }}</span>
        <div class="b">
          <b>{{ m.name }}
            <span v-if="m.is_self" class="tag">我</span>
            <span v-else-if="m.role === 'owner'" class="tag fam">管理员</span>
            <span v-if="!m.bound" class="tag off">未绑定设备</span>
          </b>
          <em>{{ m.prefs }} 条偏好 · 点过 {{ m.orders }} 顿 · {{ joined(m) }}加入</em>
        </div>
        <div class="ops">
          <button v-if="!m.is_self" class="iconbtn" :aria-label="`移除${m.name}`" @click="ask(m)">
            <Ic name="trash" class="del" />
          </button>
          <span v-else class="hint" style="font-size:11px">这台</span>
        </div>
      </div>

      <StateBlock v-if="!loading && !rows.length" kind="empty" title="没有成员"
                  desc="这台设备看起来还没加入家庭" icon="user" />
    </div>

    <div class="pad" style="margin-top:16px">
      <div v-if="err" class="banner err" style="margin-bottom:12px">
        <Ic name="x" :size="16" /><div><b>没能移除</b>{{ err }}</div>
      </div>

      <div class="banner info">
        <Ic name="leaf" :size="16" />
        <div><b>移除是数据库层面的操作</b>规则写在 0004 迁移里，不是按钮藏起来就算：
          谁都能移除别人，但<b>没人能移除自己</b>——想离开这个家，让家人帮你点这一下，
          你回到加入页重新填邀请码就行。</div>
      </div>

      <p class="hint" style="margin-top:12px;line-height:1.9">
        <b>「未绑定设备」是什么</b>：示范数据里的假人，只为让偏好投票和头像有东西可显示，
        没有对应的手机。移除他们会连带删掉那些票。<br>
        <b>移除不会删掉历史</b>：TA 点过的订单保留，只是不再显示是谁点的。</p>
    </div>

    <Teleport to="body">
      <div v-if="target" class="sheet">
        <button class="mask" @click="!busy && (target = null)" />
        <div class="pan" style="max-height:none">
          <div class="grab" />
          <div class="hd"><b>移除「{{ target.name }}」？</b><em>remove member</em></div>

          <div class="hint" style="line-height:1.9;margin-bottom:16px">
            <div v-if="target.prefs">· 会连带删掉 TA 投的 <b>{{ target.prefs }}</b> 条口味偏好，
              随机配菜里「全家平均」的权重跟着变</div>
            <div v-if="target.orders">· TA 点过的 <b>{{ target.orders }}</b> 笔订单保留，
              但不再显示是谁点的</div>
            <div v-if="target.bound">· 那台设备立刻掉出这个家，
              要重新填邀请码 <b class="mono">{{ code }}</b> 才进得来</div>
            <div v-else>· TA 没绑过设备，移除不影响任何人的手机</div>
            <div>· 直接落库，<b>不可撤销</b></div>
          </div>

          <div style="display:flex;gap:11px">
            <button class="btn o" style="flex:1" :disabled="busy" @click="target = null">取消</button>
            <button class="btn w" style="flex:1" :disabled="busy" @click="confirmRemove">
              <Ic name="trash" :size="15" />{{ busy ? '移除中…' : '仍要移除' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import Ic from '../components/Ic.vue';
import StateBlock from '../components/StateBlock.vue';
import { useSessionStore } from '../stores/session';
import { memberOverview, removeMember } from '../services/family';

const session = useSessionStore();
const rows = ref([]);
const loading = ref(false);
const busy = ref(false);
const target = ref(null);
const err = ref('');

const code = computed(() => session.family?.invite_code || '——');

async function load(force = false) {
  if (loading.value && !force) return;
  loading.value = true; err.value = '';
  try { rows.value = await memberOverview(); }
  catch (e) { err.value = e.message || String(e); }
  finally { loading.value = false; }
}

async function ask(m) { err.value = ''; target.value = m; }

async function confirmRemove() {
  const m = target.value;
  busy.value = true; err.value = '';
  try {
    await removeMember(m.id);
    target.value = null;
    rows.value = await memberOverview();
    // 首页徽章和「我的」卡片上的人数读的是 store，不同步就会一直显示旧数字
    await session.reloadMembers().catch(() => {});
  } catch (e) {
    // 数据库拒绝就照原样把理由摊开，别在这儿替它编一句安慰话
    err.value = (e.message || String(e)).replace(/^HTTP \d+ /, '');
    target.value = null;
  } finally {
    busy.value = false;
  }
}

const initial = n => (n || '家').trim().slice(0, 1);
const joined = m => {
  const d = m.joined && new Date(m.joined);
  return d && !Number.isNaN(d.getTime()) ? `${d.getMonth() + 1}月${d.getDate()}日` : '—月—日';
}

onMounted(load);
</script>
