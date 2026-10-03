import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const sbHost = (() => {
    try { return new URL(env.VITE_SB_URL).hostname; } catch { return ''; }
  })();

  return {
    // GitHub Pages 没有 SPA rewrite，配合 hash 路由用相对路径，仓库子目录也能跑
    base: './',
    plugins: [
      vue(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png'],
        manifest: {
          // Pages 部署在 /family-menu/ 子路径下，这里必须用相对值。
          // 写成 '/' 会让 PWA 启动时跳到仓库根目录，白屏
          id: './',
          name: '米粒爱吃饭',
          short_name: '米粒爱吃饭',
          description: '家庭内部使用的轻量点餐与菜品管理',
          lang: 'zh-CN',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#F4F1E9',
          theme_color: '#F4F1E9',
          start_url: './',
          scope: './',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,webp}'],
          navigateFallback: 'index.html',
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              // 读接口 stale-while-revalidate：断网也能翻菜库
              urlPattern: ({ url, sameOrigin }) =>
                !sameOrigin && sbHost !== '' && url.hostname === sbHost && url.pathname.startsWith('/rest/v1/'),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'sb-api',
                networkTimeoutSeconds: 6,
                cacheableResponse: { statuses: [0, 200] },
                expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 7 },
              },
            },
            {
              // 菜品图 cache-first，图片不会变
              urlPattern: ({ url, sameOrigin }) =>
                !sameOrigin && sbHost !== '' && url.hostname === sbHost && url.pathname.startsWith('/storage/v1/'),
              handler: 'CacheFirst',
              options: {
                cacheName: 'sb-images',
                cacheableResponse: { statuses: [0, 200] },
                expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 180 },
              },
            },
          ],
        },
      }),
    ],
    server: { host: true, port: 5173 },
    build: { target: 'es2020' },
  };
});
