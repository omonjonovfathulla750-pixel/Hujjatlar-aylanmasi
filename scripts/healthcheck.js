// Docker HEALTHCHECK: /api/v1/health 200 qaytarsa chiqish kodi 0, aks holda 1.
const port = process.env.PORT || 3000;
const ctrl = new AbortController();
setTimeout(() => ctrl.abort(), 2500).unref();
try {
  const r = await fetch(`http://127.0.0.1:${port}/api/v1/health`, { signal: ctrl.signal });
  process.exit(r.ok ? 0 : 1);
} catch {
  process.exit(1);
}
