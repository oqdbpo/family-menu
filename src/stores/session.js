import { defineStore } from 'pinia';
import { ref, computed, reactive } from 'vue';
import { ensureSession, myFamily, listMembers, resetMemberCache, createFamily, joinFamily } from '../services/family';
import { loadDicts } from '../services/dicts';
import { classifyError } from '../config';
import { pending } from '../lib/db';
import { onSync } from '../lib/sync';

export const useSessionStore = defineStore('session', () => {
  const booted = ref(false);
  const busy = ref(false);
  const error = ref(null);          // 'offline' | 'auth' | 'error' | null
  const family = ref(null);
  const members = ref([]);
  // 本机被别的设备顶掉过一次，用于在加入页解释"为什么我被赶出来了"
  const evicted = ref(false);
  const dicts = ref(null);
  const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine);

  const familyId = computed(() => family.value?.id || null);
  const ingredients = computed(() => dicts.value?.ingredients || []);
  const methods = computed(() => dicts.value?.methods || []);
  const tags = computed(() => dicts.value?.tags || []);

  async function boot() {
    if (booted.value || busy.value) return;
    busy.value = true;
    error.value = null;
    try {
      const s = await ensureSession();
      if (s.error) throw s.error;
      family.value = await myFamily();
      if (family.value) {
        members.value = await listMembers();
        dicts.value = await loadDicts();
      }
    } catch (e) {
      error.value = classifyError(e);
    } finally {
      busy.value = false;
      booted.value = true;
    }
  }

  async function retry() {
    booted.value = false;
    resetMemberCache();
    await boot();
  }

  async function enter(name, myName) {
    const row = name ? await createFamily(name, myName) : null;
    if (row) {
      family.value = { id: row.family_id, name: row.name ?? null, invite_code: row.invite_code };
    }
    if (!family.value) family.value = await myFamily();
    members.value = await listMembers();
    dicts.value = await loadDicts();
    booted.value = true;
    return family.value;
  }

  async function join(code, myName) {
    await joinFamily(code, myName);   // 里面会作废成员缓存：认领到了哪一行只有数据库知道
    evicted.value = false;
    family.value = await myFamily();
    members.value = await listMembers();
    dicts.value = await loadDicts();
    booted.value = true;
    return family.value;
  }

  async function refreshDicts() { dicts.value = await loadDicts(true); }

  // 成员管理页改过人之后，首页徽章和「我的」卡片上的人数要跟着变
  async function reloadMembers() {
    if (!family.value) return;
    const rows = await listMembers();
    // 一个名字同一时间只认一台设备（0009）。家里另一台手机点了同一个名字，本机就被顶下来，
    // RLS 于是把整个家藏起来 —— 名单空但家庭还在 = 我们已经不是这个家的人了。
    // 不处理的话页面会继续显示旧数据、写操作一条条被拒，看起来像"坏了"
    if (!rows.length) { dropFamily(); return; }
    members.value = rows;
  }

  // 清掉本机身份，让路由把关把人送回加入页；留在原地只会一直读缓存
  function dropFamily() {
    family.value = null;
    members.value = [];
    resetMemberCache();
    evicted.value = true;
  }

  // 成员名单是这台设备上「家里还剩谁」的唯一依据：别的设备加入或被移除，人数徽章
  // 不该一直停在旧值。tag 留空 = 每一轮同步都跑它。
  onSync(async () => {
    if (family.value) await reloadMembers();
    // 另一种情况更要紧：这台设备当初是因为连不上才卡在"没加入"的（境内网络是高概率失败，
    // 不是断网，navigator.onLine 一直是 true，所以 online 事件根本不会来）。
    // 网络通了它该自己爬起来，而不是逼家里人手动刷新页面。
    else if (error.value && !busy.value) await retry();
  });

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => { online.value = true; });
    window.addEventListener('offline', () => { online.value = false; });
  }

  return { booted, busy, error, family, familyId, members, dicts, online, pending, evicted,
           ingredients, methods, tags, boot, retry, enter, join, refreshDicts, reloadMembers };
});
