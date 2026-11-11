// Foydalanuvchi parolini/rolini o'zgartirish (server ishlayotgan DB bilan):
//   npm run user -- set-password U001 "YangiParol123"
//   npm run user -- set-role U002 operator
// Docker: docker compose exec api node --disable-warning=ExperimentalWarning scripts/user-admin.js set-password U001 "..."
import { hashPassword } from '../src/auth.js';
import { loadConfig, ROLES } from '../src/config.js';
import { openDb } from '../src/db.js';
import { createRepo } from '../src/repo.js';

export function runUserAdmin(repo, [cmd, code, value]) {
  const user = code ? repo.userByCode(code) : null;
  if (!user) throw new Error(`Foydalanuvchi topilmadi: ${code}`);
  if (cmd === 'set-password') {
    if (!value || value.length < 8) throw new Error('Parol kamida 8 belgi boʻlishi kerak');
    repo.setPassword(user.id, hashPassword(value));
    return `${code}: parol yangilandi`;
  }
  if (cmd === 'set-role') {
    if (!ROLES.includes(value)) throw new Error(`Rol quyidagilardan biri boʻlishi kerak: ${ROLES.join(', ')}`);
    repo.setRole(user.id, value);
    return `${code}: rol ${value} qilindi`;
  }
  throw new Error('Buyruq: set-password <ID> <parol> | set-role <ID> <rol>');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const config = loadConfig({ ...process.env, JWT_SECRET: process.env.JWT_SECRET || 'x'.repeat(32), ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'unused-pass', SEED_DEMO: 'false' });
    const repo = createRepo(openDb(config.dbPath));
    console.log(runUserAdmin(repo, process.argv.slice(2)));
  } catch (e) {
    console.error('Xato:', e.message);
    process.exit(1);
  }
}
