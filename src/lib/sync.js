import { ref } from 'vue';
import { flush, pending, onPeerWrite } from './db';

// 多设备同步的调度中心：这里只决定「什么时候去对一次账」，对什么由各 store 和页面自己注册。
// 跨设备只有 HTTP 轮询这一条路 —— 唯一出口是 REST，反代白名单里没有 /realtime
// （理由和实测记录在 README 37.16），所以「新鲜」是四个触发源凑出来的：
// 周期到点、回到前台、刚联网、同一台设备的另一个标签页写了数据。

const TICK_MS = 45_000;        // 页面可见时的对账周期
const FOREGROUND_MS = 10_000;  // 切回前台时，距上次超过这个间隔就立刻补一次

export const syncing = ref(false);
export const lastSyncAt = ref(0);

const jobs = new Set();   // { tag, fn }

/** 注册一个静默刷新任务。tag 为空 = 每轮都跑；有 tag = 只有同 tag 的写入事件才跑（周期轮询照跑） */
export function onSync(fn, tag = '') {
  jobs.add({ fn, tag });
}

// 没有可用会话时不许重放队列：请求会被 RLS 判成"业务错误"，那条操作就永久卡在队头了
let ready = () => true;
let running = null;

export function syncNow({ tag = '', drain = true, force = false } = {}) {
  if (running) return running;                                    // 一轮没跑完不叠第二轮
  // 页面在后台时不出网（省电，也不白占家里那点免费流量）。但用户主动点"同步"就得真跑一次
  if (!force && typeof document !== 'undefined' && document.hidden) return Promise.resolve();
  if (typeof navigator !== 'undefined' && !navigator.onLine) return Promise.resolve();

  running = (async () => {
    syncing.value = true;
    try {
      // 先把自己欠的传出去，再去看别人改了什么 —— 顺序反了会把本机待发的改动当成"远端新增"
      if (drain && ready() && pending.value) await flush();
      for (const job of [...jobs]) {
        if (tag && job.tag && job.tag !== tag) continue;
        // 单个任务失败不拖垮整轮，各 store 自己会把错误收进自己的 error 态
        try { await job.fn(); } catch { /* 由 store 负责显示 */ }
      }
      lastSyncAt.value = Date.now();
    } finally {
      syncing.value = false;
      running = null;
    }
  })();
  return running;
}

let started = false;
export function startSync({ canUpload } = {}) {
  if (canUpload) ready = canUpload;
  if (started || typeof window === 'undefined') return;
  started = true;

  // 页面在后台时 setInterval 会被浏览器节流，回到前台那一下由 visibilitychange 补上
  setInterval(() => syncNow(), TICK_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastSyncAt.value > FOREGROUND_MS) syncNow();
  });
  window.addEventListener('online', () => syncNow());
  onPeerWrite(tag => syncNow({ tag, drain: false }));
}
