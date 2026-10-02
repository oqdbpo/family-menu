<template>
  <nav class="tabbar" aria-label="主导航">
    <RouterLink v-for="t in tabs" :key="t.key" :to="t.to"
                :class="{ on: current === t.key, dice: t.dice }" :aria-label="t.label">
      <span v-if="t.dice" class="d"><Ic :name="t.icon" /></span>
      <Ic v-else :name="t.icon" />
      <span>{{ t.label }}</span>
    </RouterLink>
  </nav>
</template>

<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import Ic from './Ic.vue';

const tabs = [
  { key: 'home',      to: '/',          icon: 'home',  label: '首页' },
  { key: 'order',     to: '/order',     icon: 'order', label: '点餐' },
  { key: 'random',    to: '/random',    icon: 'dice',  label: '随机', dice: true },
  { key: 'favorites', to: '/favorites', icon: 'book',  label: '常吃' },
  { key: 'me',        to: '/dishes',    icon: 'user',  label: '我的' },
];
const route = useRoute();
const current = computed(() => route.meta.tab || '');
</script>
