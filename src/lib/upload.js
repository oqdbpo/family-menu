import { sb } from './supabase';
import { uuid } from './db';

// 免费层只有 1GB 存储 + 5GB 月出口，手机原图 3–5MB 一张，传 300 张就爆。
// 所以图片必须在浏览器里压完再上传，不给「直接传原图」这条路。
export async function compress(file, { max = 800, quality = 0.72 } = {}) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();

  const toBlob = (type, q) => new Promise(res => {
    if (c.convertToBlob) c.convertToBlob({ type, quality: q }).then(res).catch(() => res(null));
    else c.toBlob(b => res(b), type, q);
  });

  let blob = await toBlob('image/webp', quality);
  if (!blob || blob.size > 240_000) blob = (await toBlob('image/webp', 0.6)) || blob;
  if (!blob) blob = await toBlob('image/jpeg', 0.72);
  return { blob, type: blob?.type || 'image/jpeg' };
}

export async function uploadDishImage(file, familyId) {
  if (!familyId) throw new Error('还没加入家庭');
  const { blob, type } = await compress(file);
  if (!blob) throw new Error('这张图没法处理，换一张试试');
  const ext = type.includes('webp') ? 'webp' : 'jpg';
  const path = `${familyId}/${uuid()}.${ext}`;
  const { error } = await sb.storage.from('dish-images').upload(path, blob, { contentType: type, upsert: true });
  if (error) throw error;
  return { path, bytes: blob.size };
}
