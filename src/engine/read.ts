/** Small readers for provider response bodies. They accept the shapes the docs describe and return nothing on the rest. */

export type Rec = Record<string, unknown>;

export function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The array of rows in a response: the body itself, or the first array under one of `keys`. */
export function rowsOf(result: unknown, keys: string[] = ["data", "ads", "results", "items", "posts", "jobs"]): Rec[] {
  if (Array.isArray(result)) return result.filter(isRec);
  if (!isRec(result)) return [];
  for (const k of keys) {
    const v = result[k];
    if (Array.isArray(v)) return v.filter(isRec);
  }
  // looot may hand back the provider body one level down.
  for (const k of ["result", "body"]) {
    const inner: unknown = result[k];
    if (inner !== undefined && inner !== result) {
      const rows = rowsOf(inner, keys);
      if (rows.length) return rows;
    }
  }
  return [];
}

/** A row with its JSON:API `attributes` merged over its own fields. */
export function flat(row: Rec): Rec {
  return isRec(row.attributes) ? { ...row, ...row.attributes } : row;
}

export function str(o: Rec, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

/** An ISO timestamp from an ISO string, epoch seconds or epoch milliseconds. null when there is none. */
export function dateOf(o: Rec, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v !== "") {
      const t = Date.parse(v);
      if (Number.isFinite(t)) return new Date(t).toISOString();
    }
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      const ms = v < 1e11 ? v * 1000 : v;
      return new Date(ms).toISOString();
    }
  }
  return null;
}

/** First finite number found under any of `keys`, searching the whole body depth first. */
export function findNumber(v: unknown, keys: string[], depth = 0): number | undefined {
  if (depth > 8) return undefined;
  if (isRec(v)) {
    for (const k of keys) {
      const x = v[k];
      if (typeof x === "number" && Number.isFinite(x)) return x;
      if (typeof x === "string" && x.trim() !== "" && Number.isFinite(Number(x))) return Number(x);
    }
    for (const x of Object.values(v)) {
      const n = findNumber(x, keys, depth + 1);
      if (n !== undefined) return n;
    }
  } else if (Array.isArray(v)) {
    for (const x of v) {
      const n = findNumber(x, keys, depth + 1);
      if (n !== undefined) return n;
    }
  }
  return undefined;
}

/** First object anywhere in the body that has all of `keys`. */
export function findObject(v: unknown, keys: string[], depth = 0): Rec | undefined {
  if (depth > 10) return undefined;
  if (isRec(v)) {
    if (keys.every((k) => k in v)) return v;
    for (const x of Object.values(v)) {
      const o = findObject(x, keys, depth + 1);
      if (o) return o;
    }
  } else if (Array.isArray(v)) {
    for (const x of v) {
      const o = findObject(x, keys, depth + 1);
      if (o) return o;
    }
  }
  return undefined;
}
