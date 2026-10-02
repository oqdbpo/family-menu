import { createRouter, createWebHashHistory } from 'vue-router';
import { useSessionStore } from '../stores/session';

// hash 路由：GitHub Pages 没有 SPA rewrite，history 模式刷新子路由会 404
const routes = [
  { path: '/join',     name: 'join',      component: () => import('../views/Join.vue'), meta: { chrome: 'none' } },
  { path: '/',         name: 'home',      component: () => import('../views/Home.vue'),      meta: { tab: 'home', chrome: 'tab' } },
  { path: '/order',    name: 'order',     component: () => import('../views/Order.vue'),     meta: { tab: 'order', chrome: 'dock' } },
  { path: '/random',   name: 'random',    component: () => import('../views/Random.vue'),    meta: { tab: 'random', chrome: 'tab' } },
  { path: '/today',    name: 'today',     component: () => import('../views/TodayOrder.vue'),meta: { tab: 'today', chrome: 'dock' } },
  { path: '/favorites',name: 'favorites', component: () => import('../views/Favorites.vue'), meta: { tab: 'favorites', chrome: 'tab' } },
  { path: '/dishes',   name: 'dishes',    component: () => import('../views/DishManage.vue'),meta: { tab: 'favorites', chrome: 'tab' } },
  { path: '/:any(.*)', redirect: '/' },
];

const router = createRouter({ history: createWebHashHistory(), routes });

router.beforeEach(async to => {
  const s = useSessionStore();
  if (!s.booted) await s.boot();
  // 没落到配置页时，一切未加入家庭的状态都先去过道页
  if (to.name !== 'join' && !s.error && !s.familyId) return { name: 'join' };
  if (to.name === 'join' && s.familyId) return { name: 'home' };
  return true;
});

export default router;
