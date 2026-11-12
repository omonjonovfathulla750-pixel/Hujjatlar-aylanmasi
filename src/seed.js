// Boshlang'ich ma'lumotlar: tashkilotlar, xodimlar (namuna HTML'dagi bilan bir xil) va ixtiyoriy demo hujjatlar.
import { addDays, daysBetween } from './dates.js';
import { hashPassword } from './auth.js';
import { tx } from './db.js';
import { createRepo } from './repo.js';

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

export async function seedBase(repo, config) {
  // Idempotent: tashkilotlar va boshlang'ich akkauntlar (admin + U001) bazada bo'lmasa avtomatik yaratiladi
  if ((await repo.countOrgs()) === 0) {
    for (const n of ORGS) await repo.insertOrg(n);
  }

  const adminHash = hashPassword(config.adminPassword);
  const includeDemoUsers = config.seedDemo || config.nodeEnv === 'test';
  const empRaw = includeDemoUsers ? config.demoPassword : (config.employeePassword ?? (config.demoPassword || '12345678'));
  const empHash = empRaw ? hashPassword(empRaw) : null;

  if ((await repo.countUsers()) === 0) {
    const list = includeDemoUsers ? USERS : USERS.filter(([, , , role, code]) => role === 'admin' || code === 'U001');
    for (const [name, org_id, pos, role, code] of list) {
      await repo.insertUser({ name, org_id, pos, role, code, password_hash: role === 'admin' ? adminHash : empHash });
    }
    return;
  }

  // Mavjud bazada boshlang'ich akkauntlar (admin va U001) nechta foydalanuvchi bo'lishidan qat'i nazar
  // har doim mavjud va faol bo'lishini kafolatlaymiz
  const admin = await repo.userByCode('admin');
  if (!admin) {
    const [name, org_id, pos, role, code] = USERS.find(([, , , r]) => r === 'admin');
    await repo.insertUser({ name, org_id, pos, role, code, password_hash: adminHash });
  } else {
    if (!admin.active) await repo.setActive(admin.id, true);
    if (!admin.password_hash) await repo.setPassword(admin.id, adminHash);
  }

  const u001 = await repo.userByCode('U001');
  if (!u001) {
    const [name, org_id, pos, role, code] = USERS.find(([, , , , c]) => c === 'U001');
    await repo.insertUser({ name, org_id, pos, role, code, password_hash: empHash });
  } else {
    if (!u001.active) await repo.setActive(u001.id, true);
    if (!u001.password_hash && empHash) await repo.setPassword(u001.id, empHash);
  }
}

// Deterministik demo ma'lumotlar (namuna HTML'dagi generator'ning o'zgarmagan mantig'i).
export async function seedDemo(db, repo, { today }) {
  if ((await repo.countDocs()) > 0) return 0;
  const SEED = addDays(today, -1);
  const yy = SEED.slice(2, 4);
  const T0 = ['Nazorat varaqasi', 'Xat', 'Buyruq', 'Farmoyish'];
  const TT = ['Hisobot tayyorlash', 'Maʼlumotlarni tekshirish', 'Xavfsizlik auditi', 'Javob xatini tayyorlash', 'Tarmoq monitoringi', 'Shartnoma loyihasi', 'Oylik tahlil', 'Yangilanishlarni joriy etish'];
  let r = 11;
  const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const orgs = await repo.listOrgs();
  const ids = (await repo.listUsers()).filter((u) => u.role === 'user').map((u) => u.id);
  const adminId = (await repo.userByCode('admin')).id;
  let count = 0;

  await tx(db, async (tdb) => {
    const trepo = createRepo(tdb);
    const mkDoc = async (cd, force) => {
      const number = `${101 + (await trepo.countDocs())}/-${yy}`;
      const type = pick(T0);
      const title = `${pick(TT)} boʻyicha topshiriq`;
      const docOrg = pick(orgs).id;
      const docId = await trepo.insertDoc({ number, type, title, org_id: docOrg, created_by: adminId, created_at: cd });
      for (let k = 0, nt = rnd() < 0.3 ? 2 : 1; k < nt; k += 1) {
        const dl = force ? addDays(cd, 1) : addDays(cd, 3 + Math.floor(rnd() * 8));
        const taskId = await trepo.insertTask({ doc_id: docId, title: pick(TT), issued_by: pick(ids), deadline: dl });
        const na = rnd() < 0.1 ? 0 : 1 + Math.floor(rnd() * 3);
        for (const u of [...ids].sort(() => rnd() - 0.5).slice(0, na)) {
          let done = null;
          const x = rnd();
          if (!force) {
            if (dl < SEED) {
              if (x < 0.8) done = addDays(cd, 1 + Math.floor(rnd() * Math.max(1, daysBetween(cd, dl))));
              else if (x < 0.92) done = addDays(dl, 1 + Math.floor(rnd() * 3));
            } else if (x < 0.12) done = addDays(cd, 1);
          }
          if (done && done > SEED) done = SEED;
          await trepo.insertAssignee({ task_id: taskId, user_id: u, assigned_by: adminId, assigned_at: cd, done_date: done });
        }
      }
      const sigUsers = [...ids].sort(() => rnd() - 0.5).slice(0, 1 + Math.floor(rnd() * 3));
      for (let i = 0; i < sigUsers.length; i += 1) {
        const u = sigUsers[i];
        const signed = cd < addDays(SEED, -17) || rnd() < 0.75 ? addDays(cd, i) : null;
        await trepo.insertSignature({ doc_id: docId, user_id: u, ord: i + 1, signed_at: signed && signed <= SEED ? signed : null });
      }
      if (rnd() < 0.35) {
        const to = pick(orgs.filter((o) => o.id !== docOrg));
        await trepo.insertTransfer({ doc_id: docId, from_org: docOrg, to_org: to.id, sent_at: addDays(cd, 1), received_at: rnd() < 0.7 ? addDays(cd, 2) : null });
      }
      count += 1;
    };

    for (let d = `${SEED.slice(0, 4)}-01-02`; d <= SEED; d = addDays(d, 1)) {
      const recent = d >= addDays(SEED, -3);
      const n = recent ? 2 : (rnd() < 0.4 ? 1 + (rnd() < 0.3 ? 1 : 0) : 0);
      for (let i = 0; i < n; i += 1) await mkDoc(d, d === addDays(SEED, -2) && i === 0);
    }
  });
  return count;
}
