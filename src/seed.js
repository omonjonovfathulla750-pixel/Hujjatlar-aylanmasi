// Boshlang'ich ma'lumotlar: tashkilotlar, xodimlar (namuna HTML'dagi bilan bir xil) va ixtiyoriy demo hujjatlar.
import { addDays, daysBetween } from './dates.js';
import { hashPassword } from './auth.js';
import { tx } from './db.js';

export const ORGS = ['Ichki ishlar vazirligi', 'Adliya vazirligi', 'Moliya vazirligi', 'Axborot texnologiyalari vazirligi'];

export const USERS = [
  ['Yangi xodim (Shablon)', 1, 'Boshlangʻich roʻyxatdan oʻtish shabloni', 'user', 'U001'],
  ['Karimova Dilnoza Akmal qizi', 1, 'Yetakchi mutaxassis (YPX)', 'user', 'U002'],
  ['Aliyev Sardor Baxtiyor oʻgʻli', 1, 'Katta inspektor (PPX)', 'user', 'U003'],
  ['Rahimov Jasur Olim oʻgʻli', 2, 'Boʻlim boshligʻi', 'user', 'U004'],
  ['Yusupova Malika Anvar qizi', 2, 'Mutaxassis', 'user', 'U005'],
  ['Tursunov Bekzod Karim oʻgʻli', 3, 'Departament boshligʻi', 'user', 'U006'],
  ['Qodirova Nigora Sobir qizi', 3, 'Yetakchi iqtisodchi', 'user', 'U007'],
  ['Saidov Anvar Rustam oʻgʻli', 4, 'Dasturiy taʼminot boshligʻi', 'user', 'U008'],
  ['Administrator', 1, 'Tizim administratori', 'admin', 'admin'],
];

export function seedBase(repo, config) {
  // Idempotent: tashkilotlar va boshlang'ich akkauntlar (admin + U001) bazada bo'lmasa avtomatik yaratiladi
  if (repo.countOrgs() === 0) ORGS.forEach((n) => repo.insertOrg(n));

  const adminHash = hashPassword(config.adminPassword);
  const includeDemoUsers = config.seedDemo || config.nodeEnv === 'test';
  const empRaw = includeDemoUsers ? config.demoPassword : (config.employeePassword ?? (config.demoPassword || '12345678'));
  const empHash = empRaw ? hashPassword(empRaw) : null;

  if (repo.countUsers() === 0) {
    const list = includeDemoUsers ? USERS : USERS.filter(([, , , role, code]) => role === 'admin' || code === 'U001');
    for (const [name, org_id, pos, role, code] of list) {
      repo.insertUser({ name, org_id, pos, role, code, password_hash: role === 'admin' ? adminHash : empHash });
    }
    return;
  }

  // Mavjud bazada boshlang'ich akkauntlar (admin va U001) nechta foydalanuvchi bo'lishidan qat'i nazar
  // har doim mavjud va faol bo'lishini kafolatlaymiz
  const admin = repo.userByCode('admin');
  if (!admin) {
    const [name, org_id, pos, role, code] = USERS.find(([, , , r]) => r === 'admin');
    repo.insertUser({ name, org_id, pos, role, code, password_hash: adminHash });
  } else {
    if (!admin.active) repo.setActive(admin.id, true);
    if (!admin.password_hash) repo.setPassword(admin.id, adminHash);
  }

  const u001 = repo.userByCode('U001');
  if (!u001) {
    const [name, org_id, pos, role, code] = USERS.find(([, , , , c]) => c === 'U001');
    repo.insertUser({ name, org_id, pos, role, code, password_hash: empHash });
  } else {
    if (!u001.active) repo.setActive(u001.id, true);
    if (!u001.password_hash && empHash) repo.setPassword(u001.id, empHash);
  }
}

// Deterministik demo ma'lumotlar (namuna HTML'dagi generator'ning o'zgarmagan mantig'i).
export function seedDemo(db, repo, { today }) {
  if (repo.countDocs() > 0) return 0;
  const SEED = addDays(today, -1);
  const yy = SEED.slice(2, 4);
  const T0 = ['Nazorat varaqasi', 'Xat', 'Buyruq', 'Farmoyish'];
  const TT = ['Hisobot tayyorlash', 'Maʼlumotlarni tekshirish', 'Xavfsizlik auditi', 'Javob xatini tayyorlash', 'Tarmoq monitoringi', 'Shartnoma loyihasi', 'Oylik tahlil', 'Yangilanishlarni joriy etish'];
  let r = 11;
  const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const orgs = repo.listOrgs();
  const ids = repo.listUsers().filter((u) => u.role === 'user').map((u) => u.id);
  const adminId = repo.userByCode('admin').id;
  let count = 0;

  const mkDoc = (cd, force) => {
    const number = `${101 + repo.countDocs()}/-${yy}`;
    const type = pick(T0);
    const title = `${pick(TT)} boʻyicha topshiriq`;
    const docOrg = pick(orgs).id;
    const docId = repo.insertDoc({ number, type, title, org_id: docOrg, created_by: adminId, created_at: cd });
    for (let k = 0, nt = rnd() < 0.3 ? 2 : 1; k < nt; k += 1) {
      const dl = force ? addDays(cd, 1) : addDays(cd, 3 + Math.floor(rnd() * 8));
      const taskId = repo.insertTask({ doc_id: docId, title: pick(TT), issued_by: pick(ids), deadline: dl });
      const na = rnd() < 0.1 ? 0 : 1 + Math.floor(rnd() * 3);
      [...ids].sort(() => rnd() - 0.5).slice(0, na).forEach((u) => {
        let done = null;
        const x = rnd();
        if (!force) {
          if (dl < SEED) {
            if (x < 0.8) done = addDays(cd, 1 + Math.floor(rnd() * Math.max(1, daysBetween(cd, dl))));
            else if (x < 0.92) done = addDays(dl, 1 + Math.floor(rnd() * 3));
          } else if (x < 0.12) done = addDays(cd, 1);
        }
        if (done && done > SEED) done = SEED;
        repo.insertAssignee({ task_id: taskId, user_id: u, assigned_by: adminId, assigned_at: cd, done_date: done });
      });
    }
    [...ids].sort(() => rnd() - 0.5).slice(0, 1 + Math.floor(rnd() * 3)).forEach((u, i) => {
      const signed = cd < addDays(SEED, -17) || rnd() < 0.75 ? addDays(cd, i) : null;
      repo.insertSignature({ doc_id: docId, user_id: u, ord: i + 1, signed_at: signed && signed <= SEED ? signed : null });
    });
    if (rnd() < 0.35) {
      const to = pick(orgs.filter((o) => o.id !== docOrg));
      repo.insertTransfer({ doc_id: docId, from_org: docOrg, to_org: to.id, sent_at: addDays(cd, 1), received_at: rnd() < 0.7 ? addDays(cd, 2) : null });
    }
    count += 1;
  };

  tx(db, () => {
    for (let d = `${SEED.slice(0, 4)}-01-02`; d <= SEED; d = addDays(d, 1)) {
      const recent = d >= addDays(SEED, -3);
      const n = recent ? 2 : (rnd() < 0.4 ? 1 + (rnd() < 0.3 ? 1 : 0) : 0);
      for (let i = 0; i < n; i += 1) mkDoc(d, d === addDays(SEED, -2) && i === 0);
    }
  });
  return count;
}
