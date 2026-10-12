import Dexie from 'dexie';
import { sb } from './supabase';
import { ref } from 'vue';

const db = new Dexie('family-menu');
db.version(1).stores({ outbox: '++seq, createdAt', meta: 'key' });

/** 离线时写入先进这里，联网后按入队顺序重放 */
export const pending = ref(0);
const recount = () => db.outbox.count().then(n => { pending.value = n });
recount();

/** 重放撞上"不是网络问题"的错误就停在这条上。要给界面看，也要能被本机丢掉 */
export const stuck = ref(null);

// http://192.168.x.x 这种非安全上下文里没有 crypto.randomUUID，手机局域网调试会用到
export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// 同一台设备上的其他标签页就是"另一双眼睛"。写完吼一声，它们立刻去对账，
// 不用等下一轮轮询。跨设备没有这个通道，那条路在 lib/sync.js。
const peers = new Set();
let bus = null;
try {
  bus = new BroadcastChannel('family-menu');
  bus.onmessage = e => peers.forEach(f => f(e.data && e.data.tag));
} catch { bus = null; }   // 老浏览器/隐私模式：少一个加速通道，不影响正确性

export const onPeerWrite = fn => { peers.add(fn); return () => peers.delete(fn); };
/** 绕过 submit 的直接写（物理删除、成员管理）也要吼一声，否则其他标签页要等一轮轮询才知道 */
export const announceWrite = (tag = '') => { if (tag && bus) bus.postMessage({ tag }); };

// 只有"网络类"失败才配进队列。业务错误进队列等于把一个永远不可能成功的操作
// 伪装成"等联网就好"，用户会一直等下去
const isNetwork = err => /Failed to fetch|NetworkError|timeout|ECONN|ERR_/i.test(String(err && err.message || err));

// 别的设备抢先建了同名的菜、或者把这条订单挪走了，重放时就会撞数据库约束。
// 这些话得说人，不能把 postgres 原文甩给他
function explain(err) {
  const m = String(err && err.message || err);
  if (/duplicate key/i.test(m)) return '家里另一台设备已经存过这条了，这个不用再传。';
  if (/row-level security|42501|not logged in/i.test(m)) return '这台设备的身份变了，这个传不上去。';
  if (/check constraint|invalid input value/i.test(m)) return '这个内容被数据库判成不合法，传上去也没用。';
  return m;
}

async function runOp(op) {
  if (!sb) return new Error('未配置后端');
  switch (op.type) {
    case 'rpc':    { const { error } = await sb.rpc(op.fn, op.args); return error; }
    case 'insert': { const { error } = await sb.from(op.table).insert(op.row); return error; }
    case 'upsert': { const { error } = await sb.from(op.table).upsert(op.row, op.onConflict ? { onConflict: op.onConflict } : {}); return error; }
    case 'update': { const { error } = await sb.from(op.table).update(op.row).match(op.match); return error; }
    case 'delete': {
      // 必须是链式 .delete().eq(...)。传对象给 delete() 在 supabase-js 2.117 上
      // 不会生成 WHERE，直接报 "DELETE requires a WHERE clause"
      const { error } = await sb.from(op.table).delete().eq(op.key ?? 'id', op.id);
      return error;
    }
    default: return new Error(`未知的操作类型 ${op.type}`);
  }
}

/** 先试着直接执行；网络类失败才入队，其他错误照常抛出（不该被静默吞掉） */
export async function submit(op, { label = '', tag = '' } = {}) {
  const err = await runOp(op);
  if (!err) { announceWrite(tag); return { queued: false }; }
  if (isNetwork(err)) {
    await enqueue({ ...op, label, tag });
    return { queued: true, error: null };
  }
  return { queued: false, error: err };
}

export const enqueue = async op => { await db.outbox.add({ ...op, createdAt: Date.now() }); await recount(); };
export const listPending = () => db.outbox.orderBy('seq').toArray();

/** 联网后重放。按序执行，遇到非网络错误就停在那儿，避免把后面的操作打乱 */
export async function flush() {
  const ops = await listPending();
  const tags = new Set();
  let done = 0;
  for (const op of ops) {
    const err = await runOp(op);
    if (err) {
      await recount();
      // 还是连不上就安静等着，别把它报成"出错了"；只有换回网络之后仍然被拒的才需要人决定
      if (isNetwork(err)) return { ok: false, done, waiting: true };
      stuck.value = { seq: op.seq, label: op.label || op.table || op.fn, hint: explain(err) };
      return { ok: false, done, error: err, stuck: op };
    }
    await db.outbox.delete(op.seq);
    if (op.tag) tags.add(op.tag);
    done++;
  }
  stuck.value = null;
  await recount();
  tags.forEach(t => announceWrite(t));
  return { ok: done > 0, done };
}

/** 用户明确说"这条不要了"。只丢那一条，后面的照常按序重放 */
export async function discard(seq) {
  await db.outbox.delete(seq);
  if (stuck.value && stuck.value.seq === seq) stuck.value = null;
  await recount();
}
