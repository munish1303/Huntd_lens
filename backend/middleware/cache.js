import { LRUCache } from 'lru-cache';

const cache = new LRUCache({
  max: 500,
  ttl: 6 * 60 * 60 * 1000
});

export function getCache(key) {
  return cache.get(key) ?? null;
}

export function setCache(key, value) {
  cache.set(key, value);
}

export default cache;
