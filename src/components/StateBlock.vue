<template>
  <div v-if="kind === 'loading'" class="pad">
    <div class="sk" v-for="n in 3" :key="n" :style="{ marginTop: n > 1 ? '9px' : '0' }">
      <i style="width:66px;height:66px" />
      <div style="flex:1">
        <i style="width:52%;height:14px;display:block" />
        <i style="width:74%;height:11px;display:block;margin-top:8px" />
        <i style="width:38%;height:11px;display:block;margin-top:6px" />
      </div>
    </div>
  </div>

  <div v-else-if="kind === 'offline'" class="pad">
    <div class="off-line">
      <Ic name="leaf" :size="22" />
      <div>离线中{{ cached ? ` · 显示上次缓存的 ${cached} 道菜` : ' · 本机暂无缓存' }}</div>
      <div v-if="pending" class="hint" style="margin-top:6px">{{ pending }} 项改动已存在本机，联网后自动上传</div>
    </div>
  </div>

  <div v-else-if="kind === 'waking'" class="empty">
    <img :src="emptyArt" alt="">
    <b>正在叫醒厨房</b>
    <p>这台服务器空闲后被休眠了，通常 30–90 秒醒来。你的草稿已经存在本机，不会丢。</p>
    <button class="btn p sm" :disabled="busy" @click="$emit('retry')">
      <Ic name="swap" :size="16" />再试一次
    </button>
  </div>

  <div v-else-if="kind === 'error'" class="pad">
    <div class="banner err">
      <Ic name="x" :size="16" />
      <div><b>{{ title || '出了点问题' }}</b>{{ desc }}
        <button v-if="retryable" class="btn xs o" style="margin-left:8px" @click="$emit('retry')">重试</button>
      </div>
    </div>
  </div>

  <div v-else class="empty">
    <img v-if="image" :src="image" alt="">
    <Ic v-else :name="icon || 'leaf'" :size="30" />
    <b>{{ title || '这里还是空的' }}</b>
    <p v-if="desc">{{ desc }}</p>
    <slot />
  </div>
</template>

<script setup>
import Ic from './Ic.vue';
import emptyArt from '../assets/img/hero-empty.png';

defineProps({
  kind: { type: String, default: 'empty' },   // empty | loading | offline | waking | error
  title: String,
  desc: String,
  icon: String,
  image: String,
  cached: Number,
  pending: Number,
  busy: Boolean,
  retryable: { type: Boolean, default: true },
});
defineEmits(['retry']);
</script>
