<template>
  <svg class="ic" :style="style" aria-hidden="true"><use :href="`#i-${name}`" /></svg>
</template>

<script setup>
import { computed } from 'vue';

// 不传 size 时交给 CSS 的上下文规则决定粗细与尺寸
const props = defineProps({ name: { type: String, required: true }, size: [Number, String] });
const style = computed(() => (props.size ? { width: `${props.size}px`, height: `${props.size}px` } : null));
</script>
