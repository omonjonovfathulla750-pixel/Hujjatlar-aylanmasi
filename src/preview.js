// Tashqi kutubxonalarsiz .xlsx va .docx fayllarni brauzerda ko'rish uchun o'qish (ZIP + XML parser).
import { inflateRawSync } from 'node:zlib';

const MAX_XML_BYTES = 2 * 1024 * 1024;

function readZipEntries(buf, wantedNames) {
  const out = new Map();
  // End of Central Directory (0x06054b50) ni oxiridan izlaymiz
  let eocd = -1;
  const minPos = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minPos; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return out;

  const total = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < total && pos + 46 <= buf.length; i += 1) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const method = buf.readUInt16LE(pos + 10);
    const compSize = buf.readUInt32LE(pos + 20);
    const uncompSize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOff = buf.readUInt32LE(pos + 42);
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
    pos += 46 + nameLen + extraLen + commentLen;

    const match = typeof wantedNames === 'function' ? wantedNames(name) : wantedNames.has(name);
    if (!match || uncompSize > MAX_XML_BYTES || localOff + 30 > buf.length) continue;
    if (buf.readUInt32LE(localOff) !== 0x04034b50) continue;

    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    if (dataStart + compSize > buf.length) continue;

    const slice = buf.subarray(dataStart, dataStart + compSize);
    try {
      const raw = method === 0 ? slice : (method === 8 ? inflateRawSync(slice, { maxOutputLength: MAX_XML_BYTES }) : null);
      if (raw) out.set(name, raw.toString('utf8'));
    } catch { /* buzuq yoki juda katta yozuvni tashlab ketamiz */ }
  }
  return out;
}

function xmlUnesc(s) {
  return String(s || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function colIndex(ref) {
  const m = /^([A-Z]+)\d+$/i.exec(ref || '');
  if (!m) return -1;
  let idx = 0;
  for (const ch of m[1].toUpperCase()) idx = idx * 26 + (ch.charCodeAt(0) - 64);
  return idx - 1;
}

export function previewXlsx(buf) {
  const entries = readZipEntries(buf, (n) => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || /^xl\/worksheets\/sheet\d+\.xml$/i.test(n));
  if (!entries.size) return null;

  const shared = [];
  const ssXml = entries.get('xl/sharedStrings.xml');
  if (ssXml) {
    for (const m of ssXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
      const parts = [...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => xmlUnesc(x[1]));
      shared.push(parts.join(''));
    }
  }

  const sheetNames = [];
  const wbXml = entries.get('xl/workbook.xml');
  if (wbXml) {
    for (const m of wbXml.matchAll(/<sheet\b[^>]*name="([^"]+)"/g)) sheetNames.push(xmlUnesc(m[1]));
  }

  const sheetKeys = [...entries.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k))
    .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));

  const sheets = sheetKeys.slice(0, 5).map((key, idx) => {
    const xml = entries.get(key);
    const rows = [];
    for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      if (rows.length >= 200) break;
      const row = [];
      for (const cm of rm[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = cm[1];
        const inner = cm[2];
        const refM = /\br="([A-Z]+\d+)"/i.exec(attrs);
        const typeM = /\bt="([^"]+)"/.exec(attrs);
        const t = typeM ? typeM[1] : '';
        let val = '';
        if (t === 'inlineStr') {
          val = [...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((x) => xmlUnesc(x[1])).join('');
        } else {
          const vm = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner);
          if (vm) {
            const raw = xmlUnesc(vm[1]);
            val = t === 's' ? (shared[Number(raw)] ?? '') : raw;
          }
        }
        const ci = refM ? colIndex(refM[1]) : row.length;
        if (ci >= 0 && ci < 50) {
          while (row.length <= ci) row.push('');
          row[ci] = val;
        }
      }
      if (row.some((c) => c !== '')) rows.push(row);
    }
    const maxCols = Math.max(0, ...rows.map((r) => r.length));
    for (const r of rows) while (r.length < maxCols) r.push('');
    return { name: sheetNames[idx] || `Varaq ${idx + 1}`, rows };
  });

  return { kind: 'xlsx', sheets };
}

export function previewDocx(buf) {
  const entries = readZipEntries(buf, new Set(['word/document.xml']));
  const xml = entries.get('word/document.xml');
  if (!xml) return null;

  const paragraphs = [];
  for (const pm of xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
    const text = [...pm[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => xmlUnesc(m[1])).join('').trim();
    if (text) paragraphs.push(text);
    if (paragraphs.length >= 400) break;
  }

  const tables = [];
  for (const tm of xml.matchAll(/<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/g)) {
    const rows = [];
    for (const trm of tm[1].matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)) {
      const cells = [];
      for (const tcm of trm[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)) {
        const cellText = [...tcm[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => xmlUnesc(m[1])).join(' ').trim();
        cells.push(cellText);
      }
      if (cells.length) rows.push(cells);
      if (rows.length >= 200) break;
    }
    if (rows.length) tables.push(rows);
    if (tables.length >= 10) break;
  }

  return { kind: 'docx', paragraphs, tables };
}
