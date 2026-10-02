// 从 design/preview.html 抽取设计令牌与图标 sprite 到 src/
// 设计稿是视觉的唯一来源，改样式请改设计稿再跑这个，不要两边手改。
//   node tools/extract.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'design/preview.html'), 'utf8');

const sprite = html.match(/<svg style="display:none"[\s\S]*?<\/svg>/);
if (!sprite) throw new Error('design/preview.html 里找不到图标 sprite');

const tokens = html.match(/:root\{[\s\S]*?\n\}/);
if (!tokens) throw new Error('design/preview.html 里找不到 :root 令牌块');

fs.mkdirSync(path.join(ROOT, 'src/components'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'src/assets/styles'), { recursive: true });

fs.writeFileSync(path.join(ROOT, 'src/components/AppSprite.vue'),
  `<template>\n` +
  `  <!-- 自动生成自 design/preview.html，不要手改；改图标请改设计稿后重跑 node tools/extract.mjs -->\n` +
  `  <svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">\n` +
  sprite[0].replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '') +
  `  </svg>\n</template>\n`);

fs.writeFileSync(path.join(ROOT, 'src/assets/styles/tokens.css'),
  `/* 自动生成自 design/preview.html 的 :root —— 全站唯一色彩来源，禁止在组件里写十六进制 */\n` +
  tokens[0] + '\n');

console.log(`AppSprite.vue  ← ${(sprite[0].match(/<symbol /g) || []).length} 个 symbol`);
console.log(`tokens.css     ← ${(tokens[0].match(/--[\w-]+:/g) || []).length} 个令牌`);
