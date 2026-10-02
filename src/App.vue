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
    <div v-if="!session.online" class="pad">
      <div class="banner warn" style="margin:10px 0 0">
        <Ic name="leaf" :size="16" />
        <div><b>离线中</b>浏览用本机缓存{{ session.pending ? `；${session.pending} 项改动等联网上传` : '' }}</div>
      </div>
    </div>
    <div v-else-if="session.pending" class="pad">
      <div class="banner info" style="margin:10px 0 0">
        <Ic name="clock" :size="16" />
        <div><b>{{ session.pending }} 项改动还没传上去</b>正在等网络恢复，别关掉页面</div>
      </div>
    </div>

    <RouterView />
    <TabBar v-if="chrome === 'tab'" />
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import AppSprite from './components/AppSprite.vue';
import TabBar from './components/TabBar.vue';
import StateBlock from './components/StateBlock.vue';
import Ic from './components/Ic.vue';
import { isConfigured } from './config';
import { useSessionStore } from './stores/session';

const configured = isConfigured;
const session = useSessionStore();
const route = useRoute();

const chrome = computed(() => (configured ? route.meta.chrome || 'tab' : 'none'));
// navigator.onLine 为真但请求全失败 = 被网络中间层挡了，而不是设备断网
const blocked = computed(() => session.online && session.error === 'offline');
</script>
