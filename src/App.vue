<template>
  <AppSprite />

  <div v-if="!configured" class="app">
    <div class="empty" style="padding-top:90px">
      <b>还没配置后端地址</b>
      <p>跑 <code>node tools/gen-env.mjs</code> 从 supabase/.env.local 生成 .env，或复制 .env.example 手填</p>
    </div>
  </div>

  <div v-else-if="blocked && !session.family" class="app">
    <div class="empty" style="padding-top:70px">
      <StateBlock kind="waking" :busy="session.busy" @retry="session.retry()" />
    </div>
  </div>

  <div v-else class="app" :class="{ 'has-tabbar': chrome === 'tab', 'has-dock': chrome === 'dock' }">
    <!-- 加入家庭之前这一行没意义（还没有可同步的对象），别在过道页上多占一块 -->
    <div v-if="session.familyId" class="pad"><SyncStatus /></div>

    <div v-if="!session.online" class="pad">
      <div class="banner warn" style="margin:10px 0 0">
        <Ic name="leaf" :size="16" />
        <div><b>离线中</b>浏览用本机缓存{{ pending ? `；${pending} 项改动等联网上传` : '' }}</div>
      </div>
    </div>

    <!-- 传不上去 ≠ 没网：那是数据库拒绝了这条操作，多半是家里的另一台设备抢先一步。
         重放是按序的，卡在队头就一直卡着，所以必须给出「再试」和「这条不要了」 -->
    <div v-else-if="stuck" class="pad">
      <div class="banner err" style="margin:10px 0 0">
        <Ic name="x" :size="16" />
        <div><b>「{{ stuck.label }}」传不上去</b>{{ stuck.hint }}
          <div style="display:flex;gap:8px;margin-top:9px">
            <button class="btn xs g" :disabled="flushing" @click="retryQueue">
              <Ic name="swap" :size="12" :class="{ spin: flushing }" />再试一次</button>
            <button class="btn xs w" @click="discardStuck">这条不要了</button>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="pending" class="pad">
      <div class="banner info" style="margin:10px 0 0">
        <Ic name="clock" :size="16" />
        <div><b>{{ pending }} 项改动还没传上去</b>正在等网络恢复，别关掉页面</div>
      </div>
    </div>

    <RouterView />
    <TabBar v-if="chrome === 'tab'" />
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppSprite from './components/AppSprite.vue';
import TabBar from './components/TabBar.vue';
import StateBlock from './components/StateBlock.vue';
import SyncStatus from './components/SyncStatus.vue';
import Ic from './components/Ic.vue';
import { isConfigured } from './config';
import { useSessionStore } from './stores/session';
import { pending, stuck, flush, discard } from './lib/db';
import { startSync, syncNow } from './lib/sync';

const configured = isConfigured;
const session = useSessionStore();
const route = useRoute();
const router = useRouter();

// 被别的设备顶掉（0009：一个名字同一时间只认一台）时，store 会把这个旗举起来。
// 留在原地只会看到一片空数据和一条条被拒的写操作，直接送回加入页点一次自己的名字
watch(() => session.evicted, gone => { if (gone) router.replace('/join'); });

const chrome = computed(() => (configured ? route.meta.chrome || 'tab' : 'none'));
// navigator.onLine 为真但请求全失败 = 被网络中间层挡了，而不是设备断网
const blocked = computed(() => session.online && session.error === 'offline');

const flushing = ref(false);
onMounted(() => {
  // 没有本家庭的身份就不要重放：匿名 uid 变更或被 RLS 拒掉时，那些操作永远传不上去，
  // 会把整条队列卡在队头
  startSync({ canUpload: () => Boolean(session.familyId) && !session.busy });
  syncNow();   // 打开就立刻对一次账，不等第一个 45 秒
});

async function retryQueue() {
  flushing.value = true;
  try { await flush(); } finally { flushing.value = false; }
  syncNow({ drain: false });   // 传完了就去看一眼别人同时改了什么
}
async function discardStuck() {
  if (!stuck.value) return;
  await discard(stuck.value.seq);
  syncNow();   // 丢掉这块挡路的之后，队里后面的操作要马上接着传，不能等下一轮
}
</script>
