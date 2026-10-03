<template>
  <div>
    <div class="wordmark" style="padding-top:44px">
      <div class="en">米粒爱吃饭</div>
      <div class="sub">a lazy day in the family kitchen</div>
    </div>
    <img :src="hero" alt="" style="width:250px;margin:6px auto 0">

    <div class="pad" style="margin-top:14px">
      <div class="card">
        <Seg v-model="mode" :options="[{ value: 'join', label: '加入家庭' }, { value: 'create', label: '新建家庭' }]" />

        <template v-if="mode === 'join'">
          <div class="field" style="margin-top:18px">
            <label>家庭邀请码 <i>*</i></label>
            <input v-model="code" class="inp mono" placeholder="6 位字母" maxlength="8" autocapitalize="characters">
          </div>
          <div class="field">
            <label>我是</label>
            <input v-model="myName" class="inp" placeholder="爸爸 / 妈妈 / 孩子" maxlength="12">
          </div>
          <button class="btn p blk" :disabled="busy" @click="doJoin">
            <Ic name="user" />{{ busy ? '正在进入…' : '进入家庭' }}
          </button>
          <button v-if="demo" class="btn o blk" style="margin-top:10px" @click="code = demo; doJoin()">
            用示范家庭 {{ demo }} 先看看
          </button>
        </template>

        <template v-else>
          <div class="field" style="margin-top:18px">
            <label>家庭名称</label>
            <input v-model="familyName" class="inp" placeholder="小之家" maxlength="16">
          </div>
          <div class="field">
            <label>我是</label>
            <input v-model="myName" class="inp" placeholder="爸爸 / 妈妈 / 孩子" maxlength="12">
          </div>
          <button class="btn p blk" :disabled="busy" @click="doCreate">
            <Ic name="plus" />{{ busy ? '正在创建…' : '创建并拿到邀请码' }}
          </button>
        </template>

        <div v-if="err" class="banner err" style="margin-top:14px">
          <Ic name="x" :size="16" />
          <div><b>没成功</b>{{ err }}</div>
        </div>
      </div>

      <div class="card" v-if="created" style="margin-top:14px;text-align:center">
        <div class="hint">把这个邀请码发到家庭群，家人点开就能进</div>
        <div class="mono" style="font-size:32px;font-weight:800;letter-spacing:6px;color:var(--olive-deep);margin:8px 0">
          {{ created }}
        </div>
        <button class="btn o sm" @click="copy(created)">复制</button>
      </div>

      <p class="hint" style="text-align:center;margin-top:20px;line-height:1.9">
        不需要注册账号，每台设备各算一个成员<br>
        清掉浏览器数据后要用邀请码重新进一次
      </p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import Seg from '../components/Seg.vue';
import Ic from '../components/Ic.vue';
import { useSessionStore } from '../stores/session';
import { DEMO_INVITE } from '../config';
import hero from '../assets/img/hero-home.png';

const router = useRouter();
const session = useSessionStore();

const mode = ref(session.members.length ? 'join' : 'create');
const code = ref('');
const myName = ref('');
const familyName = ref('');
const busy = ref(false);
const err = ref('');
const created = ref('');
const demo = DEMO_INVITE;

async function doJoin() {
  err.value = '';
  if (!code.value.trim()) { err.value = '邀请码还没填'; return; }
  busy.value = true;
  try {
    await session.join(code.value.trim(), myName.value.trim() || '新成员');
    router.replace('/');
  } catch (e) { err.value = e.message || e; }
  finally { busy.value = false; }
}

async function doCreate() {
  err.value = '';
  busy.value = true;
  try {
    await session.enter(familyName.value.trim() || '我的家', myName.value.trim() || '家长');
    created.value = session.family?.invite_code || '';
    if (!created.value) router.replace('/');
  } catch (e) { err.value = e.message || e; }
  finally { busy.value = false; }
}

async function copy(t) {
  try { await navigator.clipboard.writeText(t); } catch { /* 非安全上下文没有剪贴板 API */ }
}
</script>
