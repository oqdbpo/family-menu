<template>
  <div class="seg" :class="{ warm }" role="tablist">
    <button v-for="o in options" :key="optVal(o)"
            role="tab" :aria-selected="modelValue === optVal(o)"
            :class="{ on: modelValue === optVal(o) }"
            @click="$emit('update:modelValue', optVal(o))">
      {{ optLabel(o) }}
    </button>
  </div>
</template>

<script setup>
defineProps({
  modelValue: { type: [String, Number], required: true },
  options: { type: Array, required: true },   // ['早餐','正餐'] 或 [{value,label}]
  warm: Boolean,
});
defineEmits(['update:modelValue']);
const optVal = o => (typeof o === 'object' ? o.value : o);
const optLabel = o => (typeof o === 'object' ? o.label : o);
</script>
