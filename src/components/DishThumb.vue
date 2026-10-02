<template>
  <div class="thw" :class="{ placeholder: !src }" :style="z ? { '--z': z } : null">
    <img v-if="src && !broken" :src="src" :alt="alt" loading="lazy" @error="broken = true">
    <Ic v-else name="camera" />
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { publicImageUrl } from '../lib/supabase';
import Ic from './Ic.vue';

const props = defineProps({
  path: { type: String, default: '' },   // Storage 对象路径，不是完整 URL
  url: String,
  alt: { type: String, default: '' },
  z: [String, Number],
});
const src = computed(() => props.url || publicImageUrl(props.path));
const broken = ref(false);
watch(src, () => { broken.value = false; });
</script>
