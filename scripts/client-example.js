// Admin paneli (yoki istalgan tashqi tizim) API'dan token orqali ma'lumot olishi namunasi.
// Ishga tushirish:
//   node scripts/client-example.js
//   docker compose --profile tools run --rm client
const API = (process.env.API_URL || 'http://localhost:3000/api/v1').replace(/\/$/, '');
const ID = process.env.API_ID || 'admin';
const PASSWORD = process.env.API_PASSWORD || '';

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${data?.error || 'xatolik'}`);
  return data;
}

export async function run(log = console.log) {
  if (!PASSWORD) throw new Error('API_PASSWORD berilmagan');
  const health = await call('GET', '/health');
  log(`1) Server holati: ${health.status} (v${health.version})`);

  const login = await call('POST', '/auth/login', { body: { id: ID, password: PASSWORD } });
  log(`2) Token olindi: ${login.token_type} ${login.access_token.slice(0, 18)}... (${login.expires_in}s amal qiladi)`);

  const token = login.access_token;
  const docs = await call('GET', '/documents?per_page=5', { token });
  log(`3) Hujjatlar: jami ${docs.meta.total} ta, oxirgi ${docs.data.length} tasi:`);
  docs.data.forEach((d) => log(`   - № ${d.number} | ${d.type} | ${d.title} | holat: ${d.status}`));

  const stats = await call('GET', '/stats/summary', { token });
  log(`4) Statistika: jami ${stats.total}, vaqtida ${stats.ok}, muddatdan oshgan ${stats.late} (samaradorlik ${stats.pct}%)`);
  return { health, docs, stats };
}

// Faqat to'g'ridan-to'g'ri ishga tushirilganda bajariladi (import qilinganda emas)
if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((e) => { console.error('Xato:', e.message); process.exit(1); });
}
