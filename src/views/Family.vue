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
          <span class="hint">{{ rows.length }} 人 · 邀请码 <b class="mono">{{ code }}</b>
            · {{ iAmOwner ? '你是管理员' : adminName ? `管理员是 ${adminName}` : '这个家还没有管理员' }}</span>
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
            <span v-if="m.is_owner" class="tag fam">管理员</span>
            <span v-if="!m.bound" class="tag off">未绑定设备</span>
          </b>
          <em>{{ m.prefs }} 条偏好 · 点过 {{ m.orders }} 顿 · {{ joined(m) }}加入</em>
        </div>
        <div class="ops">
          <button v-if="canPromote(m)" class="iconbtn" :aria-label="`把管理员交给${m.name}`"
                  title="把管理员交给 TA" @click="ask(m, 'promote')"><Ic name="user" /></button>
          <button v-if="!m.is_self" class="iconbtn" :aria-label="`移除${m.name}`"
                  @click="ask(m, 'remove')"><Ic name="trash" class="del" /></button>
          <span v-if="m.is_self" class="hint" style="font-size:11px">这台</span>
        </div>
      </div>

      <StateBlock v-if="!loading && !rows.length" kind="empty" title="没有成员"
                  desc="这台设备看起来还没加入家庭" icon="user" />
    </div>

    <div class="pad" style="margin-top:16px">
      <div v-if="err" class="banner err" style="margin-bottom:12px">
        <Ic name="x" :size="16" /><div><b>没能完成</b>{{ err }}</div>
      </div>

      <div class="banner info">
        <Ic name="leaf" :size="16" />
        <div><b>规则写在数据库里，不是把按钮藏起来就算</b>
          谁都能移除别人，但<b>没人能移除自己</b>——想离开这个家，让家人帮你点这一下，
          回到加入页重新填邀请码就行。<br>
          管理员要<b>先交给别人</b>才移得掉，否则改家庭名字的人就消失了。</div>
      </div>

      <p class="hint" style="margin-top:12px;line-height:1.9">
        <b>「未绑定设备」是什么</b>：示范数据里的假人，只为让偏好投票和头像有东西可显示，
        没有对应的手机。移除他们会连带删掉那些票，而且他们当不了管理员。<br>
        <b>移除不会删掉历史</b>：TA 点过的订单保留，只是不再显示是谁点的。</p>
    </div>

    <Teleport to="body">
      <div v-if="target" class="sheet">
        <button class="mask" @click="!busy && (target = null)" />
        <div class="pan" style="max-height:none">
          <div class="grab" />
          <div class="hd">
            <b>{{ mode === 'promote' ? `把管理员交给「${target.name}」？` : `移除「${target.name}」？` }}</b>
            <em>{{ mode === 'promote' ? 'hand over' : 'remove member' }}</em>
          </div>

          <div v-if="mode === 'promote'" class="hint" style="line-height:1.9;margin-bottom:16px">
            <div>· 从此 <b>{{ target.name }}</b> 一个人能改这个家的名字</div>
            <div>· 你退成普通成员：还能点菜、还能移除别人，但<b>不再是管理员</b></div>
            <div>· 想拿回来，让 TA 用同样的方式交还给你</div>
          </div>

          <div v-else class="hint" style="line-height:1.9;margin-bottom:16px">
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
            <button class="btn" :class="mode === 'promote' ? 'p' : 'w'" style="flex:1"
                    :disabled="busy" @click="execute">
              <Ic :name="mode === 'promote' ? 'user' : 'trash'" :size="15" />
              {{ busy ? '处理中…' : (mode === 'promote' ? '确认交出' : '仍要移除') }}
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
import { memberOverview, removeMember, transferOwner } from '../services/family';

const session = useSessionStore();
const rows = ref([]);
const loading = ref(false);
const busy = ref(false);
const target = ref(null);
const mode = ref('remove');
const err = ref('');

const code = computed(() => session.family?.invite_code || '——');
const me = computed(() => rows.value.find(m => m.is_self) || null);
const iAmOwner = computed(() => !!me.value?.is_owner);
const adminName = computed(() => rows.value.find(m => m.is_owner)?.name || '');

// 交给谁：得是绑了设备的真成员，且不是我自己、不是已经在位的管理员
const canPromote = m => iAmOwner.value && m.bound && !m.is_self && !m.is_owner;

async function load(force = false) {
  if (loading.value && !force) return;
  loading.value = true; err.value = '';
  try { rows.value = await memberOverview(); }
  catch (e) { err.value = e.message || String(e); }
  finally { loading.value = false; }
}

function ask(m, how) { err.value = ''; target.value = m; mode.value = how; }

async function execute() {
  const m = target.value;
  busy.value = true; err.value = '';
  try {
    await (mode.value === 'promote' ? transferOwner(m.id) : removeMember(m.id));
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
};

onMounted(load);
</script>
