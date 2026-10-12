<template>
  <!-- 全局同步状态：让家里人知道屏幕上的内容是"什么时候的"，以及本机有没有欠着没传的改动 -->
  <button class="syncbar" type="button"
          :aria-label="text" :disabled="syncing" @click="tap">
    <Ic name="swap" :size="13" :class="{ spin: syncing }" />
    <span>{{ text }}</span>
  </button>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import Ic from '../components/Ic.vue';
import { syncing, lastSyncAt, syncNow } from '../lib/sync';
import { pending, stuck } from '../lib/db';
import { useSessionStore } from '../stores/session';

const session = useSessionStore();

// 「3 分钟前」这种话不会自己变老，靠一条独立的慢时钟把它撑住
// （同步本身每 45 秒会把 lastSyncAt 推进一次，但离线/被挡时不会）
const now = ref(Date.now());
let clock = null;
onMounted(() => { clock = setInterval(() => { now.value = Date.now(); }, 20_000); });
onUnmounted(() => clearInterval(clock));

function ago(ts) {
  const s = Math.max(0, Math.round((now.value - ts) / 1000));
  if (s < 45) return '刚刚';
  if (s < 3600) return `${Math.round(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.round(s / 3600)} 小时前`;
  return `${Math.round(s / 86400)} 天前`;
}

const text = computed(() => {
  if (stuck.value) return `有改动传不上去 · ${stuck.value.label}`;
  if (!session.online) return pending.value ? `离线中 · ${pending.value} 项等联网上传` : '离线中 · 看的是本机缓存';
  // 有欠账时这句话比"正在同步"更有用：一轮同步在网络半通不通时会拖几十秒（supabase-js 内部在重试），
  // 那时候只显示"正在同步"会让人以为卡住了
  if (pending.value) return `${pending.value} 项改动还没传上去`;
  if (syncing.value) return '正在同步…';
  return lastSyncAt.value ? `已同步 · ${ago(lastSyncAt.value)}` : '第一次同步还没跑完';
});

const tap = () => syncNow({ force: true });
</script>
