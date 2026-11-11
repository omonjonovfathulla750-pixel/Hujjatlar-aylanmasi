const ID_RE = /^[1-9]\d{0,14}$/;

export class Router {
  constructor() { this.routes = []; }

  add(def) {
    const keys = [];
    const source = def.path.replace(/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; });
    this.routes.push({ ...def, keys, re: new RegExp(`^${source}/?$`) });
    return this;
  }

  // -> { route, params } | { pathMatched: true } | {}
  match(method, path) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.re.exec(path);
      if (!m) continue;
      let params;
      try {
        params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      } catch {
        continue;
      }
      // 'key' parametri matn (integratsiya), 'id' parametri musbat butun son
      const invalid = r.keys.some((k) => {
        if (k === 'key') return false;
        return !ID_RE.test(params[k]);
      });
      if (invalid) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      for (const k of r.keys) if (k !== 'key') params[k] = Number(params[k]);
      return { route: r, params };
    }
    return pathMatched ? { pathMatched } : {};
  }
}
