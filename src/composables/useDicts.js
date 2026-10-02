import { storeToRefs } from 'pinia';
import { useSessionStore } from '../stores/session';

export function useDicts() {
  const { ingredients, methods, tags } = storeToRefs(useSessionStore());
  const ingredientName = id => ingredients.value.find(i => i.id === id)?.name || '';
  const methodName = id => methods.value.find(m => m.id === id)?.name || '';
  return { ingredients, methods, tags, ingredientName, methodName };
}

export const tagClass = t => (
  t.kind === '口味' ? (/(辣)/.test(t.name) ? 'tag hot' : 'tag')
  : t.kind === '人群' ? 'tag fam'
  : 'tag');
