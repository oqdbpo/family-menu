<template>
  <Teleport to="body">
    <div v-if="modelValue" class="sheet">
      <button class="mask" aria-label="关闭" @click="close" />
      <div class="pan">
        <div class="grab" />
        <div class="hd">
          <b>{{ isNew ? '新增菜品' : '编辑菜品' }}</b><em>{{ isNew ? 'add a dish' : 'edit' }}</em>
          <button class="x iconbtn" aria-label="关闭" @click="close"><Ic name="x" :size="14" /></button>
        </div>

        <div class="field">
          <label>菜名 <i>*</i><em>dishes.name</em></label>
          <input v-model="form.name" class="inp" placeholder="比如 蒜蓉西兰花" maxlength="24">
        </div>

        <div style="display:flex;gap:11px">
          <div class="field" style="flex:1"><label>餐型<em>meal_type</em></label>
            <div class="sel"><select v-model="form.meal_type" class="inp" @change="onMealChange">
              <option v-for="m in mealTypes" :key="m" :value="m">{{ m }}</option></select></div></div>
          <div class="field" style="flex:1"><label>分类<em>category</em></label>
            <div class="sel"><select v-model="form.category" class="inp">
              <option v-for="c in categories" :key="c" :value="c">{{ c }}</option></select></div></div>
        </div>

        <div v-if="subcategories.length" class="field">
          <label>细分<em>subcategory</em></label>
          <div class="chips">
            <button type="button" class="chip" :class="{ on: !form.subcategory }" @click="form.subcategory = ''">不限</button>
            <button v-for="s in subcategories" :key="s" type="button" class="chip"
                    :class="{ on: form.subcategory === s }" @click="form.subcategory = s">{{ s }}</button>
          </div>
        </div>

        <div style="display:flex;gap:11px">
          <div class="field" style="flex:1"><label>主食材<em>ingredient</em></label>
            <div class="sel"><select v-model="form.ingredient_id" class="inp"><option :value="null">不指定</option>
              <option v-for="i in dicts.ingredients" :key="i.id" :value="i.id">{{ i.name }}</option></select></div></div>
          <div class="field" style="flex:1"><label>做法<em>method</em></label>
            <div class="sel"><select v-model="form.cooking_method_id" class="inp"><option :value="null">不指定</option>
              <option v-for="m in dicts.methods" :key="m.id" :value="m.id">{{ m.name }}</option></select></div></div>
        </div>

        <div class="field">
          <label>标签<em>tags · 多对多，可自造</em></label>
          <div class="chips">
            <button v-for="t in dicts.tags" :key="t.id" type="button" class="chip"
                    :class="{ on: tagIds.includes(t.id) }" @click="toggleTag(t.id)">{{ t.name }}</button>
          </div>
        </div>

        <div style="display:flex;gap:14px;margin-bottom:16px">
          <div style="flex:1"><div class="field" style="margin:0 0 5px"><label>辣度</label>
            <span class="spicy"><i v-for="n in 5" :key="n" :class="{ on: n <= form.spicy_level }"
              @click="form.spicy_level = n" style="cursor:pointer"></i></span></div></div>
          <div style="flex:1"><div class="field" style="margin:0 0 5px"><label>难度</label>
            <span class="spicy diff"><i v-for="n in 5" :key="n" :class="{ on: n <= form.difficulty }"
              @click="form.difficulty = n" style="cursor:pointer"></i></span></div></div>
          <div style="flex:1"><div class="field" style="margin:0 0 5px"><label>时间</label>
            <input v-model.number="form.cooking_time" type="number" min="1" max="600" class="inp mono" style="height:32px;padding:0 8px">
          </div></div>
        </div>

        <div class="field">
          <label>做法说明<em>description · 怎么做</em></label>
          <textarea v-model="form.description" class="ta" rows="3"
                    placeholder="土豆切块、鸡胸肉切块，腌肉 15 分钟，烤箱 200° 20 分钟。可以留空。"></textarea>
          <div class="hint" style="margin-top:5px">做饭时瞄的就是这几行，写"先干什么再干什么"而不是写感想</div>
        </div>

        <div class="field">
          <label>图片<em>image_path · 本机压到 ≤200KB 再传</em></label>
          <div class="upl">
            <DishThumb v-if="form.image_path" :path="form.image_path" />
            <label class="box">
              <Ic name="camera" />{{ uploading ? '处理中' : '拍照' }}
              <input type="file" accept="image/*" capture="environment" hidden @change="pick">
            </label>
            <label class="box">
              <Ic name="plus" />相册
              <input type="file" accept="image/*" hidden @change="pick">
            </label>
          </div>
          <div v-if="uploadInfo" class="hint" style="margin-top:7px">{{ uploadInfo }}</div>
        </div>

        <div v-if="err" class="banner err" style="margin-bottom:12px"><Ic name="x" :size="16" /><div>{{ err }}</div></div>

        <div style="display:flex;gap:11px">
          <button class="btn o" style="flex:1" @click="close">取消</button>
          <button class="btn p" style="flex:1.4" :disabled="!form.name.trim() || busy" @click="save">
            <Ic name="check" />{{ busy ? '保存中…' : '保存菜品' }}
          </button>
        </div>
        <p class="hint" style="margin-top:12px;text-align:center">必填只有菜名，其余全部可以跳过</p>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { reactive, ref, computed, watch } from 'vue';
import Ic from '../components/Ic.vue';
import DishThumb from '../components/DishThumb.vue';
import { useSessionStore } from '../stores/session';
import { useDishStore } from '../stores/dishes';
import { uploadDishImage } from '../lib/upload';

const props = defineProps({ modelValue: Boolean, dish: Object });
const emit = defineEmits(['update:modelValue', 'saved']);

const session = useSessionStore();
const dishes = useDishStore();
const dicts = computed(() => session.dicts || { ingredients: [], methods: [], tags: [], categoryList: [] });
const mealTypes = ['正餐', '早餐'];

const blank = () => ({ id: null, name: '', meal_type: '正餐', category: '荤菜', subcategory: '',
  ingredient_id: null, cooking_method_id: null, image_path: '', description: '', spicy_level: 0, difficulty: 1,
  cooking_time: 15, is_favorite: false, is_active: true });

const form = reactive(blank());
const tagIds = ref([]);
const isNew = computed(() => !props.dish?.id);
const busy = ref(false);
const uploading = ref(false);
const uploadInfo = ref('');
const err = ref('');

const categories = computed(() => [...new Set((dicts.value.categoryList || [])
  .filter(c => c.meal_type === form.meal_type).map(c => c.category))]);
const subcategories = computed(() => (dicts.value.categoryList || [])
  .filter(c => c.meal_type === form.meal_type && c.category === form.category && c.subcategory).map(c => c.subcategory));

function onMealChange() { if (!categories.value.includes(form.category)) form.category = categories.value[0]; }
function toggleTag(id) {
  const i = tagIds.value.indexOf(id);
  if (i >= 0) tagIds.value.splice(i, 1); else tagIds.value.push(id);
}

watch(() => [props.modelValue, props.dish], () => {
  if (!props.modelValue) return;
  err.value = ''; uploadInfo.value = '';
  Object.assign(form, blank(), props.dish ? {
    ...props.dish,
    ingredient_id: props.dish.ingredient_id ?? null,
    cooking_method_id: props.dish.cooking_method_id ?? null,
    image_path: props.dish.image_path || '',
    description: props.dish.description || '',   // 库里是 null，textarea 绑 null 容易出 "null"
  } : {});
  tagIds.value = (props.dish?.tags || []).map(t => dicts.value.tags.find(x => x.name === t.name)?.id).filter(Boolean);
}, { immediate: true });

async function pick(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  uploading.value = true; err.value = '';
  try {
    const r = await uploadDishImage(file, session.familyId);
    form.image_path = r.path;
    uploadInfo.value = `已压缩到 ${(r.bytes / 1024).toFixed(0)} KB 并上传`;
  } catch (x) { err.value = '上传失败：' + (x.message || x); }
  finally { uploading.value = false; }
}

async function save() {
  busy.value = true; err.value = '';
  const r = await dishes.save({ ...form }, tagIds.value);
  busy.value = false;
  if (r.error) { err.value = r.error.message || String(r.error); return; }
  emit('saved'); close();
}

const close = () => emit('update:modelValue', false);
</script>

<style scoped>
input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none }
</style>
