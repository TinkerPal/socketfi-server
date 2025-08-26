const { EventEmitter } = require("node:events");

class ProgressTracker {
  constructor(opts = {}) {
    this.bus = new EventEmitter();
    this.history = new Map(); // sessionId -> StepEvent[]
    this.timers = new Map(); // sessionId -> timeout
    this.opts = {
      ttlMs: opts.ttlMs ?? 15 * 60_000, // expire after 15 min of inactivity
      maxPerSession: opts.maxPerSession ?? 200, // keep last 200 events
    };
  }

  // evt: { step, status, detail?, ts?, eid? }
  push(sessionId, evt) {
    const ts = evt.ts ?? Date.now();
    const e = {
      id: sessionId,
      eid: String(evt.eid ?? ts), // event id for SSE resume
      ts,
      step: evt.step, // e.g., "auth_init.check_user"
      status: evt.status, // "start" | "ok" | "skip" | "error"
      detail: evt.detail,
    };

    const arr = this.history.get(sessionId) ?? [];
    arr.push(e);
    if (arr.length > this.opts.maxPerSession) arr.shift();
    this.history.set(sessionId, arr);

    this.bus.emit(sessionId, e);
    this.#armTtl(sessionId);
    return e;
  }

  getAll(sessionId) {
    return this.history.get(sessionId) ?? [];
  }

  getSince(sessionId, lastEid) {
    const arr = this.getAll(sessionId);
    if (!lastEid) return arr;
    const idx = arr.findIndex((e) => e.eid === lastEid);
    return idx >= 0 ? arr.slice(idx + 1) : arr;
  }

  subscribe(sessionId, listener) {
    this.bus.on(sessionId, listener);
    return () => this.bus.off(sessionId, listener);
  }

  clear(sessionId) {
    this.history.delete(sessionId);
    const t = this.timers.get(sessionId);
    if (t) clearTimeout(t);
    this.timers.delete(sessionId);
  }

  #armTtl(sessionId) {
    const { ttlMs } = this.opts;
    if (!ttlMs) return;
    const old = this.timers.get(sessionId);
    if (old) clearTimeout(old);
    const timer = setTimeout(() => this.clear(sessionId), ttlMs);
    this.timers.set(sessionId, timer);
  }
}

const progress = new ProgressTracker();

module.exports = { progress, ProgressTracker };
