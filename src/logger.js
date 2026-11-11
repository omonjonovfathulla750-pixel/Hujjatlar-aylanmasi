// JSON qatorli logger (stdout). Token va parollar HECH QACHON yozilmaydi.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export function createLogger({ level = 'info', write = (line) => process.stdout.write(line + '\n') } = {}) {
  const min = LEVELS[level] ?? LEVELS.info;
  const log = (lvl, msg, fields = {}) => {
    if (LEVELS[lvl] < min) return;
    write(JSON.stringify({ ts: new Date().toISOString(), level: lvl, msg, ...fields }));
  };
  return {
    debug: (m, f) => log('debug', m, f),
    info: (m, f) => log('info', m, f),
    warn: (m, f) => log('warn', m, f),
    error: (m, f) => log('error', m, f),
  };
}
