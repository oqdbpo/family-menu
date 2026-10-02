import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import './assets/styles/tokens.css';
import './assets/styles/ui.css';

// 每次部署后 chunk 文件名都会变，而 Pages 的部署是整体替换：旧文件直接 404。
// 于是"部署前就打开着的标签页"一旦点进某个懒加载路由（比如「我的」），
// dynamic import 拿的是已经不存在的旧文件名；autoUpdate 的 Service Worker 已经把旧
// precache 按 cleanupOutdatedCaches 清掉了，所以缓存也救不了 —— 表现就是**点了没反应**，
// 控制台里只有一条 404，界面上什么提示都没有。家人手机上必然会遇到。
// Vite 把这个失败以 vite:preloadError 抛在 window 上，接住它重载一次即可拿到新包。
window.addEventListener('vite:preloadError', e => {
  e.preventDefault();
  const k = 'fm-recovered-at';
  const last = Number(sessionStorage.getItem(k) || 0);
  // 只自救一次：15 秒内已经重载过就不再刷，避免"网络真断了"时的无限重载
  if (Date.now() - last < 15_000) return;
  sessionStorage.setItem(k, String(Date.now()));
  location.reload();
});

createApp(App).use(createPinia()).use(router).mount('#app');
