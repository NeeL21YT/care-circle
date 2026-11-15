/**
 * Minimal in-memory Firestore fake covering the subset the services use:
 * collection/doc/collectionGroup, get/set/update/create/delete, where/orderBy/
 * limit, transactions and batches. Values may be Date or Timestamp-like.
 * It is a test double, not a spec-complete emulator.
 */
type Data = Record<string, unknown>;

const millis = (v: unknown): unknown => {
  if (v instanceof Date) return v.getTime();
  if (v && typeof v === "object" && "toMillis" in (v as object)) return (v as { toMillis: () => number }).toMillis();
  return v;
};
const clone = (d: Data): Data => structuredClone(d);

function get(obj: Data, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Data)[k] : undefined), obj);
}

export class FakeSnap {
  constructor(readonly ref: FakeDocRef, private d: Data | undefined) {}
  get exists() { return this.d !== undefined; }
  get id() { return this.ref.id; }
  data() { return this.d ? clone(this.d) : undefined; }
}

export class FakeQuerySnap {
  constructor(readonly docs: FakeSnap[]) {}
  get empty() { return this.docs.length === 0; }
  get size() { return this.docs.length; }
  forEach(fn: (d: FakeSnap) => void) { this.docs.forEach(fn); }
}

type Filter = [string, string, unknown];

export class FakeDocRef {
  constructor(private store: FakeFirestore, readonly path: string) {}
  get id() { return this.path.split("/").pop()!; }
  get parent() { return new FakeCollection(this.store, this.path.split("/").slice(0, -1).join("/")); }
  collection(name: string) { return new FakeCollection(this.store, `${this.path}/${name}`); }
  async get() { return new FakeSnap(this, this.store.docs.get(this.path)); }
  async set(data: Data, opts?: { merge?: boolean }) {
    this.store.docs.set(this.path, opts?.merge ? { ...(this.store.docs.get(this.path) ?? {}), ...clone(data) } : clone(data));
  }
  async create(data: Data) {
    if (this.store.docs.has(this.path)) {
      const e = new Error(`ALREADY_EXISTS: ${this.path}`) as Error & { code: number };
      e.code = 6;
      throw e;
    }
    this.store.docs.set(this.path, clone(data));
  }
  async update(data: Data) {
    const cur = this.store.docs.get(this.path);
    if (!cur) throw new Error(`NOT_FOUND: ${this.path}`);
    const next = clone(cur);
    for (const [k, v] of Object.entries(data)) {
      const parts = k.split(".");
      let o = next as Data;
      for (const p of parts.slice(0, -1)) o = (o[p] ??= {}) as Data;
      o[parts.at(-1)!] = v instanceof Date ? v : structuredClone(v);
    }
    this.store.docs.set(this.path, next);
  }
  async delete() { this.store.docs.delete(this.path); }
}

export class FakeQuery {
  constructor(
    protected store: FakeFirestore,
    protected match: (path: string) => boolean,
    protected filters: Filter[] = [],
    protected order: [string, "asc" | "desc"][] = [],
    protected max?: number,
  ) {}
  where(f: string, op: string, v: unknown) { return new FakeQuery(this.store, this.match, [...this.filters, [f, op, v]], this.order, this.max); }
  orderBy(f: string, dir: "asc" | "desc" = "asc") { return new FakeQuery(this.store, this.match, this.filters, [...this.order, [f, dir]], this.max); }
  limit(n: number) { return new FakeQuery(this.store, this.match, this.filters, this.order, n); }
  async get() {
    let rows = [...this.store.docs.entries()].filter(([p]) => this.match(p));
    rows = rows.filter(([, d]) => this.filters.every(([f, op, v]) => {
      const a = millis(get(d, f));
      const b = Array.isArray(v) ? v.map(millis) : millis(v);
      switch (op) {
        case "==": return a === b;
        case "!=": return a !== b;
        case "<": return (a as number) < (b as number);
        case "<=": return (a as number) <= (b as number);
        case ">": return (a as number) > (b as number);
        case ">=": return (a as number) >= (b as number);
        case "in": return (b as unknown[]).includes(a);
        case "array-contains": return Array.isArray(get(d, f)) && (get(d, f) as unknown[]).map(millis).includes(b);
        default: throw new Error(`unsupported op ${op}`);
      }
    }));
    for (const [f, dir] of [...this.order].reverse()) {
      rows.sort(([, x], [, y]) => {
        const a = millis(get(x, f)) as number, b = millis(get(y, f)) as number;
        return (a < b ? -1 : a > b ? 1 : 0) * (dir === "asc" ? 1 : -1);
      });
    }
    if (this.max !== undefined) rows = rows.slice(0, this.max);
    return new FakeQuerySnap(rows.map(([p, d]) => new FakeSnap(new FakeDocRef(this.store, p), d)));
  }
}

export class FakeCollection extends FakeQuery {
  constructor(store: FakeFirestore, readonly path: string) {
    super(store, (p) => {
      const segs = p.split("/");
      return p.startsWith(path + "/") && segs.length === path.split("/").length + 1;
    });
  }
  get id() { return this.path.split("/").pop()!; }
  get parent() { const segs = this.path.split("/"); return segs.length > 1 ? new FakeDocRef(this.store, segs.slice(0, -1).join("/")) : null; }
  doc(id?: string) { return new FakeDocRef(this.store, `${this.path}/${id ?? Math.random().toString(36).slice(2, 12)}`); }
  async add(data: Data) { const r = this.doc(); await r.set(data); return r; }
}

export class FakeFirestore {
  docs = new Map<string, Data>();
  settings() {}
  collection(path: string) { return new FakeCollection(this, path); }
  doc(path: string) { return new FakeDocRef(this, path); }
  collectionGroup(name: string) {
    return new FakeQuery(this, (p) => {
      const s = p.split("/");
      return s.length % 2 === 0 && s[s.length - 2] === name;
    });
  }
  batch() {
    const ops: (() => Promise<void>)[] = [];
    const b = {
      set: (r: FakeDocRef, d: Data, o?: { merge?: boolean }) => { ops.push(() => r.set(d, o)); return b; },
      create: (r: FakeDocRef, d: Data) => { ops.push(() => r.create(d)); return b; },
      update: (r: FakeDocRef, d: Data) => { ops.push(() => r.update(d)); return b; },
      delete: (r: FakeDocRef) => { ops.push(() => r.delete()); return b; },
      commit: async () => { for (const op of ops) await op(); },
    };
    return b;
  }
  /** Serialized transactions: read-then-write with no interleaving. */
  private lock: Promise<unknown> = Promise.resolve();
  runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    const run = async () => {
      const writes: (() => Promise<void>)[] = [];
      const tx = {
        get: (x: FakeDocRef | FakeQuery) => x.get(),
        set: (r: FakeDocRef, d: Data, o?: { merge?: boolean }) => { writes.push(() => r.set(d, o)); return tx; },
        create: (r: FakeDocRef, d: Data) => { writes.push(() => r.create(d)); return tx; },
        update: (r: FakeDocRef, d: Data) => { writes.push(() => r.update(d)); return tx; },
        delete: (r: FakeDocRef) => { writes.push(() => r.delete()); return tx; },
      };
      const result = await fn(tx);
      for (const w of writes) await w();
      return result;
    };
    const p = this.lock.then(run, run);
    this.lock = p.catch(() => undefined);
    return p;
  }
}
