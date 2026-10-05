/**
 * Tiny path language used by data-driven effects:
 *   "traffic.baseRps"
 *   "endpoints[id=catalog].cpuMs"
 *   "files[path=/var/www/html/backup.sql]"
 *   "nodes[id=web1].config.listenPort"
 */

type Token = { key: string } | { sel: [string, string] };

export function parsePath(path: string): Token[] {
  const tokens: Token[] = [];
  let buf = '';
  let i = 0;
  const flush = () => {
    if (buf) tokens.push({ key: buf });
    buf = '';
  };
  while (i < path.length) {
    const c = path[i];
    if (c === '.') {
      flush();
      i++;
    } else if (c === '[') {
      flush();
      const end = path.indexOf(']', i);
      if (end < 0) throw new Error(`Unclosed selector in path "${path}"`);
      const inner = path.slice(i + 1, end);
      const eq = inner.indexOf('=');
      if (eq < 0) throw new Error(`Selector must be [key=value] in "${path}"`);
      tokens.push({ sel: [inner.slice(0, eq), inner.slice(eq + 1)] });
      i = end + 1;
    } else {
      buf += c;
      i++;
    }
  }
  flush();
  return tokens;
}

type AnyObj = Record<string, unknown>;

function step(cur: unknown, tok: Token): unknown {
  if (cur == null) return undefined;
  if ('key' in tok) return (cur as AnyObj)[tok.key];
  if (!Array.isArray(cur)) return undefined;
  const [k, v] = tok.sel;
  return cur.find((item) => item && String((item as AnyObj)[k]) === v);
}

export function getAt(root: unknown, path: string): unknown {
  let cur = root;
  for (const tok of parsePath(path)) cur = step(cur, tok);
  return cur;
}

function parentAndLast(root: unknown, path: string): { parent: unknown; last: Token } {
  const tokens = parsePath(path);
  if (!tokens.length) throw new Error('Empty path');
  let cur = root;
  for (const tok of tokens.slice(0, -1)) {
    let nextVal = step(cur, tok);
    if (nextVal === undefined && 'key' in tok && cur && typeof cur === 'object') {
      nextVal = {};
      (cur as AnyObj)[tok.key] = nextVal;
    }
    cur = nextVal;
    if (cur == null) throw new Error(`Path not found: ${path}`);
  }
  return { parent: cur, last: tokens[tokens.length - 1] };
}

export function setAt(root: unknown, path: string, value: unknown): void {
  const { parent, last } = parentAndLast(root, path);
  if ('key' in last) {
    (parent as AnyObj)[last.key] = value;
    return;
  }
  if (!Array.isArray(parent)) throw new Error(`Selector on non-array: ${path}`);
  const [k, v] = last.sel;
  const idx = parent.findIndex((item) => item && String((item as AnyObj)[k]) === v);
  if (idx >= 0) parent[idx] = value;
  else parent.push(value);
}

export function removeAt(root: unknown, path: string): void {
  const { parent, last } = parentAndLast(root, path);
  if ('key' in last) {
    if (Array.isArray(parent)) return;
    delete (parent as AnyObj)[last.key];
    return;
  }
  if (!Array.isArray(parent)) return;
  const [k, v] = last.sel;
  const idx = parent.findIndex((item) => item && String((item as AnyObj)[k]) === v);
  if (idx >= 0) parent.splice(idx, 1);
}

export function pushAt(root: unknown, path: string, value: unknown): void {
  let arr = getAt(root, path);
  if (arr === undefined) {
    setAt(root, path, []);
    arr = getAt(root, path);
  }
  if (!Array.isArray(arr)) throw new Error(`Not an array: ${path}`);
  const id = value && typeof value === 'object' ? (value as AnyObj).id : undefined;
  if (id !== undefined) {
    const idx = arr.findIndex((x) => x && (x as AnyObj).id === id);
    if (idx >= 0) {
      arr[idx] = value;
      return;
    }
  }
  arr.push(value);
}

export function mergeAt(root: unknown, path: string, value: AnyObj): void {
  const target = getAt(root, path);
  if (target && typeof target === 'object' && !Array.isArray(target)) {
    Object.assign(target as AnyObj, value);
  } else {
    setAt(root, path, { ...value });
  }
}
