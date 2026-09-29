'use strict';

/**
 * In-process stand-in for the handful of Redis commands the provider layer
 * uses (`get`/`set`/`incr`/`pExpire`/`del`/`mGet`/`setMany`). Used as the
 * fallback when Redis errors, and extended by the test fake.
 *
 * ponytail: expiry is checked lazily on read, never swept; the key set is
 * bounded by provider × environment so it cannot grow.
 */
class MemoryStore {
  constructor() {
    this.map = new Map();
  }

  entry(key) {
    const item = this.map.get(key);
    if (!item) return null;
    if (item.expiresAt !== null && item.expiresAt <= Date.now()) {
      this.map.delete(key);
      return null;
    }
    return item;
  }

  async get(key) {
    return this.entry(key)?.value ?? null;
  }

  async set(key, value, { ex, px, nx } = {}) {
    if (nx && this.entry(key)) return null;
    const ttl = px ?? (ex ? ex * 1000 : null);
    this.map.set(key, { value: String(value), expiresAt: ttl ? Date.now() + ttl : null });
    return 'OK';
  }

  async incr(key) {
    const current = this.entry(key);
    const next = (current ? Number(current.value) : 0) + 1;
    this.map.set(key, { value: String(next), expiresAt: current?.expiresAt ?? null });
    return next;
  }

  async pExpire(key, ms) {
    const current = this.entry(key);
    if (!current) return 0;
    this.map.set(key, { ...current, expiresAt: Date.now() + ms });
    return 1;
  }

  async del(keys) {
    let removed = 0;
    for (const key of [].concat(keys)) {
      if (this.map.delete(key)) removed += 1;
    }
    return removed;
  }

  async mGet(keys) {
    return keys.map((key) => this.entry(key)?.value ?? null);
  }

  async setMany(entries, { ex } = {}) {
    for (const [key, value] of entries) {
      await this.set(key, value, { ex });
    }
    return entries.map(() => 'OK');
  }
}

module.exports = { MemoryStore };
