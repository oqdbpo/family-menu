<template>
  <div>
    <div class="wordmark" style="padding-top:14px">
      <div class="en">今天吃什么</div>
      <div class="sub">a lazy day in the family kitchen</div>
    </div>

    <div style="margin-top:12px">
      <RouterLink to="/dishes" class="fambadge">
        <Ic name="leaf" :size="13" />{{ session.family?.name || '我的家' }} · {{ session.members.length }} 人
      </RouterLink>
    </div>

    <img :src="hero" alt="厨房水彩主视觉" style="width:280px;margin:6px auto 0">

    <div class="mosaic">
      <RouterLink to="/order" class="card big tap">
        <span class="illu"><Ic name="order" /></span>
        <span class="bi"><em>order</em><b>我要点餐</b></span>
        <span class="hint" style="font-size:11px">早餐 · 正餐 · 火锅</span>
      </RouterLink>

      <RouterLink to="/today" class="card mrow tap">
        <Ic name="bowl" />
        <span class="bi"><em>today</em><b>今日点餐</b></span>
        <span v-if="order.count" class="tag freq" style="margin-left:auto">{{ order.count }} 道</span>
        <Ic v-else name="right" :size="16" class="ar" />
      </RouterLink>

      <RouterLink to="/random" class="card mrow tap">
        <Ic name="dice" :style="{ stroke: 'var(--terracotta)' }" />
        <span class="bi"><em>random</em><b>随机吃什么</b></span>
        <Ic name="right" :size="16" class="ar" />
      </RouterLink>
    </div>

    <RouterLink to="/favorites" class="wide tap card">
      <Ic name="clock" :size="26" />
      <span class="l"><b>我的常吃</b><em>frequently eaten</em>
        <p>{{ dishes.frequent.length ? `${dishes.frequent[0].name} 已经 ${dishes.frequent[0].eat_count} 次` : '还没有点餐记录' }}</p></span>
      <Ic name="right" :size="16" class="ar" />
    </RouterLink>

    <RouterLink to="/favorites" class="wide tap card" @click="favTab = '收藏'">
      <Ic name="heart" :size="26" :style="{ stroke: 'var(--mauve)' }" />
      <span class="l"><b>我的收藏</b><em>favorites</em>
        <p>{{ dishes.favorites.length }} 道 · 很久没吃的 {{ dishes.stale }} 道</p></span>
      <Ic name="right" :size="16" class="ar" />
    </RouterLink>

    <RouterLink to="/dishes" class="wide tap card">
      <Ic name="menu3" :size="26" />
      <span class="l"><b>菜品管理</b><em>dishes</em>
        <p>共 {{ dishes.all.length }} 道 · 点按可增删改</p></span>
      <Ic name="right" :size="16" class="ar" />
    </RouterLink>

    <div style="padding:18px 18px 0">
      <div class="stats">
        <div><b>{{ dishes.all.length }}</b><em>在库菜品</em></div>
        <div><b>{{ dishes.favorites.length }}</b><em>收藏</em></div>
        <div><b>{{ order.count }}</b><em>今日已点</em></div>
      </div>
    </div>

    <div class="hand" style="text-align:center;font-size:16px;padding:20px 0 6px">eat well, together</div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import Ic from '../components/Ic.vue';
import { useSessionStore } from '../stores/session';
import { useDishStore } from '../stores/dishes';
import { useOrderStore } from '../stores/orders';
import hero from '../assets/img/hero-home.png';

const session = useSessionStore();
const dishes = useDishStore();
const order = useOrderStore();
const favTab = ref('收藏');

onMounted(() => { dishes.load(); order.load(); });
</script>
