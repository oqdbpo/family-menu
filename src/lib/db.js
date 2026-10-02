import Dexie from 'dexie';
import { sb } from './supabase';
import { ref } from 'vue';

const db = new Dexie('family-menu');
db.version(1).stores({ outbox: '++seq, createdAt', meta: 'key' });

/** 离线时写入先进这里，联网后按入队顺序重放 */
export const pending = ref(0);
const refresh = () => db.outbox.count().then(n => { pending.value = n });
refresh();

// http://192.168.x.x 这种非安全上下文里没有 crypto.randomUUID，手机局域网调试会用到
export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
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
export async function submit(op, { label = '' } = {}) {
  const err = await runOp(op);
  if (!err) return { queued: false };
  if (/Failed to fetch|NetworkError|timeout|ECONN|ERR_/i.test(String(err.message || err))) {
    await enqueue({ ...op, label });
    return { queued: true, error: null };
  }
  return { queued: false, error: err };
}

export const enqueue = async op => { await db.outbox.add({ ...op, createdAt: Date.now() }); await refresh(); };
export const listPending = () => db.outbox.orderBy('seq').toArray();
export const clearPending = async () => { await db.outbox.clear(); await refresh(); };

/** 联网后重放。按序执行，遇到非网络错误就停在那儿，避免把后面的操作打乱 */
export async function flush() {
  const ops = await listPending();
  let done = 0;
  for (const op of ops) {
    const err = await runOp(op);
    if (err) {
      await refresh();
      return { ok: false, done, error: err, stuck: op };
    }
    await db.outbox.delete(op.seq);
    done++;
  }
  await refresh();
  return { ok: done > 0, done };
}
