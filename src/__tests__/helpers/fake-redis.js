'use strict';

/**
 * Test double for `src/repositories/data-source`'s `redis` with the same
 * command surface the provider layer uses, plus `eval` implementing the
 * token-bucket semantics of `shared-rate-limiter.js`'s Lua script in JS
 * (refill by elapsed ms from the caller-supplied `now`, cap at burst,
 * consume one or return the wait). Set `failing = true` to make every
 * command reject, which exercises the in-memory fallbacks.
 */

const { MemoryStore } = require('../../infrastructure/providers/memory-store');

const wrap = (fn) =>
  async function guarded(...args) {
    if (this.failing) throw new Error('fake redis down');
    this.calls.push([fn.name, ...args]);
    return fn.apply(this, args);
  };

class FakeRedis extends MemoryStore {
  constructor() {
    super();
    this.failing = false;
    this.calls = [];
    for (const name of ['get', 'set', 'incr', 'pExpire', 'del', 'mGet', 'setMany', 'eval']) {
      this[name] = wrap(this[name]);
    }
  }

  async eval(script, [key], [rps, burst, now, ttl]) {
    const state = this.map.get(`${key}#bucket`) || { tokens: Number(burst), ts: Number(now) };
    const rate = Number(rps);
    const cap = Number(burst);
    const at = Number(now);
    if (at > state.ts) {
      state.tokens = Math.min(cap, state.tokens + ((at - state.ts) * rate) / 1000);
      state.ts = at;
    }
    let wait = 0;
    if (state.tokens >= 1) {
      state.tokens -= 1;
    } else {
      wait = Math.ceil(((1 - state.tokens) * 1000) / rate);
    }
    this.map.set(`${key}#bucket`, state);
    await MemoryStore.prototype.set.call(this, key, '1', { px: Number(ttl) });
    return wait;
  }
}

module.exports = { FakeRedis };
