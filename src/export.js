// Tashqi kutubxonalarsiz haqiqiy Excel (.xlsx) va Word (.docx) eksport generatori (ECMA-376 OOXML + ZIP).
import { crc32 as zlibCrc32, deflateRawSync } from 'node:zlib';

const CRC_TABLE = (() => {
  if (typeof zlibCrc32 === 'function') return null;
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  if (typeof zlibCrc32 === 'function') return zlibCrc32(buf) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { name, content } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const compressed = deflateRawSync(raw);
    const crc = crc32(raw);

    const lh = Buffer.alloc(30 + nameBuf.length);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6); // UTF-8
    lh.writeUInt16LE(8, 8); // deflate
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0x5421, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(compressed.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    nameBuf.copy(lh, 30);

    locals.push(lh, compressed);

    const ch = Buffer.alloc(46 + nameBuf.length);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x5421, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(compressed.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    nameBuf.copy(ch, 46);
    centrals.push(ch);

    offset += lh.length + compressed.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

const xmlEsc = (v) => String(v ?? '')
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

function colLetter(n) {
  let s = '';
  let x = n + 1;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

const MIN_THEME_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office">
  <a:themeElements>
    <a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>
    <a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
    <a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
  </a:themeElements>
</a:theme>`;

const corePropsXml = (isoNow = new Date().toISOString().replace(/\.\d+Z$/, 'Z')) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Hujjat aylanish tizimi</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${isoNow}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${isoNow}</dcterms:modified></cp:coreProperties>`;

const appPropsXml = (appName) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>${xmlEsc(appName)}</Application></Properties>`;

const pctPart = (part, total) => (total ? Math.round((part / total) * 100) : 0);

function createSharedStrings() {
  const map = new Map();
  const list = [];
  let totalCount = 0;

  function intern(text) {
    const key = String(text ?? '');
    totalCount += 1;
    let idx = map.get(key);
    if (idx === undefined) {
      idx = list.length;
      map.set(key, idx);
      list.push(key);
    }
    return idx;
  }

  function toXml() {
    const items = list.map((s) => `<si><t xml:space="preserve">${xmlEsc(s)}</t></si>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${totalCount}" uniqueCount="${list.length}">${items}</sst>`;
  }

  return { intern, toXml };
}

// Har bir qator: { cells: Array<string|number|{v, s}>, ht?: number, s?: number }
function buildSheetXml(rowDefs, colWidths, sst, active = false) {
  const maxCol = Math.max(1, colWidths.length, ...rowDefs.map((r) => r.cells.length));
  const maxRow = Math.max(1, rowDefs.length);
  const dim = `A1:${colLetter(maxCol - 1)}${maxRow}`;
  const colsXml = colWidths.length
    ? `<cols>${colWidths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';

  const body = rowDefs.map((row, ri) => {
    const cellsXml = row.cells.map((raw, ci) => {
      if (raw === null || raw === undefined || raw === '') return '';
      const cellObj = typeof raw === 'object' && raw !== null && 'v' in raw ? raw : { v: raw };
      const val = cellObj.v;
      if (val === null || val === undefined || val === '') return '';
      const stIdx = cellObj.s ?? row.s ?? 2;
      const ref = `${colLetter(ci)}${ri + 1}`;
      if (typeof val === 'number' && Number.isFinite(val)) {
        return `<c r="${ref}" s="${stIdx}"><v>${val}</v></c>`;
      }
      const strIdx = sst.intern(val);
      return `<c r="${ref}" t="s" s="${stIdx}"><v>${strIdx}</v></c>`;
    }).filter(Boolean).join('');
    if (!cellsXml) return '';
    const htAttr = row.ht ? ` ht="${row.ht}" customHeight="1"` : '';
    return `<row r="${ri + 1}"${htAttr}>${cellsXml}</row>`;
  }).filter(Boolean).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${dim}"/><sheetViews><sheetView${active ? ' tabSelected="1"' : ''} workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="18"/>${colsXml}<sheetData>${body}</sheetData></worksheet>`;
}

export function buildXlsx({
  title = 'Hujjat aylanish tizimi — Ijro nazorati hisoboti',
  periodLabel,
  generatedAt = '',
  filterNote = '',
  summary,
  yearlySummary = null,
  docCount = 0,
  rows = [],
  orgStats = [],
  userStats = [],
  monthlyStats = [],
}) {
  const sst = createSharedStrings();
  const sOkPct = pctPart(summary.ok, summary.total);
  const sProgPct = pctPart(summary.prog, summary.total);
  const sLatePct = pctPart(summary.late, summary.total);
  const sNewPct = pctPart(summary.new, summary.total);

  // Stilar: 0=oddiy, 1=jadval sarlavha, 2=oddiy katak, 3=katta sarlavha, 4=bo'lim sarlavha, 5=qalin matn
  const sheet1Rows = [
    { ht: 26, cells: [{ v: title, s: 3 }] },
    { ht: 20, cells: [{ v: `Davr: ${periodLabel}${generatedAt ? ' · Shakllantirildi: ' + generatedAt : ''}${filterNote ? ' · Filtr: ' + filterNote : ''}`, s: 0 }] },
    { cells: [] },
    { ht: 22, cells: [{ v: '1. Umumiy ijro statistikasi', s: 4 }] },
    { ht: 24, s: 1, cells: ['Koʻrsatkich', 'Soni / Qiymat', 'Ulushi (%)', 'Izoh'] },
    { cells: [{ v: 'Jami topshiriqlar', s: 5 }, summary.total, '100%', yearlySummary ? `Yil boʻyicha: ${yearlySummary.total} ta` : 'Tanlangan davr boʻyicha'] },
    { cells: [{ v: 'Vaqtida bajarildi', s: 5 }, summary.ok, `${sOkPct}%`, `${summary.ok} ta topshiriq muddatida yopilgan`] },
    { cells: [{ v: 'Jarayonda', s: 5 }, summary.prog, `${sProgPct}%`, `${summary.prog} ta topshiriq bajarilmoqda`] },
    { cells: [{ v: 'Muddatdan oshdi', s: 5 }, summary.late, `${sLatePct}%`, `${summary.late} ta topshiriq muddati oʻtgan`] },
    { cells: [{ v: 'Biriktirilmagan', s: 5 }, summary.new, `${sNewPct}%`, 'Bajaruvchi belgilanmagan'] },
    { cells: [{ v: 'Bajarilish samaradorligi (%)', s: 5 }, summary.pct, `${summary.pct}%`, 'Vaqtida bajarilganlar ulushi'] },
    { cells: [{ v: 'Oʻrtacha bajarilish (kun)', s: 5 }, summary.avg_days, '—', 'Topshiriq yopilishining oʻrtacha muddati'] },
    { cells: [{ v: 'Jami hujjatlar soni', s: 5 }, docCount, '—', 'Hisobotdagi hujjatlar'] },
    { cells: [] },
    { ht: 22, cells: [{ v: '2. Hujjatlar va topshiriqlar ijrosi', s: 4 }] },
    {
      ht: 26,
      s: 1,
      cells: [
        '№', 'Hujjat raqami', 'Turi', 'Tashkilot', 'Boʻlim', 'Mazmuni',
        'Muhimlik', 'Topshiriq', 'Bajaruvchi', 'Koʻrilgan vaqt', 'Muddat', 'Bajarilgan sana', 'Holat',
      ],
    },
    ...(rows.length
      ? rows.map((r, i) => ({
        cells: [
          i + 1,
          r.number,
          r.type,
          r.org,
          r.department || '—',
          r.docTitle,
          r.priorityLabel,
          r.taskTitle,
          r.assignee,
          r.viewedAt || 'Koʻrilmagan',
          r.deadline,
          r.doneDate || '—',
          r.statusLabel,
        ],
      }))
      : [{ cells: ['—', '—', '—', '—', '—', 'Tanlangan filtr boʻyicha topshiriqlar topilmadi', '—', '—', '—', '—', '—', '—', '—'] }]),
  ];

  const statRows = [
    { ht: 26, cells: [{ v: `Statistika (${periodLabel})`, s: 3 }] },
    { cells: [] },
    { ht: 24, s: 1, cells: ['Koʻrsatkich', 'Qiymat', 'Ulushi (%)'] },
    { cells: ['Jami topshiriqlar', summary.total, '100%'] },
    { cells: ['Vaqtida bajarildi', summary.ok, `${sOkPct}%`] },
    { cells: ['Jarayonda', summary.prog, `${sProgPct}%`] },
    { cells: ['Muddatdan oshdi', summary.late, `${sLatePct}%`] },
    { cells: ['Biriktirilmagan', summary.new, `${sNewPct}%`] },
    { cells: ['Samaradorlik (%)', summary.pct, `${summary.pct}%`] },
    { cells: ['Oʻrtacha bajarilish (kun)', summary.avg_days, '—'] },
    { cells: ['Jami hujjatlar', docCount, '—'] },
  ];

  if (orgStats.length) {
    statRows.push({ cells: [] });
    statRows.push({ ht: 22, cells: [{ v: 'Tashkilotlar boʻyicha koʻrsatkichlar', s: 4 }] });
    statRows.push({ ht: 24, s: 1, cells: ['Tashkilot', 'Jami', 'Vaqtida bajarildi', 'Jarayonda', 'Muddatdan oshdi', 'Samaradorlik (%)'] });
    for (const o of orgStats) {
      statRows.push({ cells: [o.name, o.total, o.ok, o.prog, o.late, `${o.pct}%`] });
    }
  }

  if (userStats.length) {
    statRows.push({ cells: [] });
    statRows.push({ ht: 22, cells: [{ v: 'Xodimlar boʻyicha koʻrsatkichlar', s: 4 }] });
    statRows.push({ ht: 24, s: 1, cells: ['Xodim', 'Jami', 'Vaqtida bajarildi', 'Jarayonda', 'Muddatdan oshdi', 'Samaradorlik (%)'] });
    for (const u of userStats) {
      statRows.push({ cells: [u.name, u.total, u.ok, u.prog, u.late, `${u.pct}%`] });
    }
  }

  if (monthlyStats.length) {
    statRows.push({ cells: [] });
    statRows.push({ ht: 22, cells: [{ v: 'Oylar boʻyicha taqsimot', s: 4 }] });
    statRows.push({ ht: 24, s: 1, cells: ['Oy', 'Jami', 'Vaqtida bajarildi', 'Jarayonda', 'Muddatdan oshdi', 'Samaradorlik (%)'] });
    for (const m of monthlyStats) {
      statRows.push({ cells: [m.label, m.total, m.ok, m.prog, m.late, `${m.pct}%`] });
    }
  }

  const sheet1Xml = buildSheetXml(sheet1Rows, [6, 16, 18, 28, 20, 32, 14, 28, 24, 20, 14, 16, 20], sst, true);
  const sheet2Xml = buildSheetXml(statRows, [34, 18, 18, 22, 18, 18], sst, false);

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="4">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="14"/><color rgb="FF1F4E78"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF1F4E78"/><name val="Calibri"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD9D9D9"/></left>
      <right style="thin"><color rgb="FFD9D9D9"/></right>
      <top style="thin"><color rgb="FFD9D9D9"/></top>
      <bottom style="thin"><color rgb="FFD9D9D9"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="6">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
  </cellXfs>
</styleSheet>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="20000" windowHeight="12000"/></bookViews>
  <sheets>
    <sheet name="Hisobot" sheetId="1" r:id="rId1"/>
    <sheet name="Statistika" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`;

  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
</Relationships>`;

  return makeZip([
    { name: '[Content_Types].xml', content: contentTypes },
    { name: '_rels/.rels', content: rootRels },
    { name: 'docProps/core.xml', content: corePropsXml() },
    { name: 'docProps/app.xml', content: appPropsXml('Microsoft Excel') },
    { name: 'xl/workbook.xml', content: workbook },
    { name: 'xl/_rels/workbook.xml.rels', content: wbRels },
    { name: 'xl/theme/theme1.xml', content: MIN_THEME_XML },
    { name: 'xl/styles.xml', content: styles },
    { name: 'xl/sharedStrings.xml', content: sst.toXml() },
    { name: 'xl/worksheets/sheet1.xml', content: sheet1Xml },
    { name: 'xl/worksheets/sheet2.xml', content: sheet2Xml },
  ]);
}

function wCell(text, widthDxa, { bold = false, fill = null, color = null } = {}) {
  const shd = fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : '';
  const txtColor = color || (bold && fill ? 'FFFFFF' : '0F172A');
  const rPr = `<w:rPr>${bold ? '<w:b/>' : ''}<w:color w:val="${txtColor}"/><w:sz w:val="18"/></w:rPr>`;
  return `<w:tc><w:tcPr><w:tcW w:w="${widthDxa}" w:type="dxa"/>${shd}<w:tcMar><w:top w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:r>${rPr}<w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r></w:p></w:tc>`;
}

function wTable(headers, rows, colWidths) {
  const totalWidth = colWidths.reduce((s, w) => s + w, 0);
  const grid = `<w:tblGrid>${colWidths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
  const borders = `<w:tblBorders>
    <w:top w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>
    <w:left w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>
    <w:bottom w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>
    <w:right w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>
    <w:insideH w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>
    <w:insideV w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>
  </w:tblBorders>`;
  const hdrRow = `<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>${headers.map((h, i) => wCell(h, colWidths[i], { bold: true, fill: '1F4E78', color: 'FFFFFF' })).join('')}</w:tr>`;
  const bodyRows = rows.map((r, ri) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((c, ci) => wCell(c, colWidths[ci], ri % 2 === 1 ? { fill: 'F8FAFC' } : {})).join('')}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${totalWidth}" w:type="dxa"/>${borders}<w:tblLayout w:type="fixed"/></w:tblPr>${grid}${hdrRow}${bodyRows}</w:tbl>`;
}

export function buildDocx({
  title,
  periodLabel,
  generatedAt,
  filterNote = '',
  summary,
  yearlySummary = null,
  docCount = 0,
  rows = [],
  orgStats = [],
  userStats = [],
}) {
  const sOkPct = pctPart(summary.ok, summary.total);
  const sProgPct = pctPart(summary.prog, summary.total);
  const sLatePct = pctPart(summary.late, summary.total);
  const sNewPct = pctPart(summary.new, summary.total);

  // A4 Landscape kontent kengligi = 16838 - 720 - 720 = 15398 dxa
  const statTable = wTable(
    ['Koʻrsatkich', 'Qiymat', 'Ulushi / Izoh'],
    [
      ['Jami topshiriqlar', `${summary.total} ta`, yearlySummary ? `100% (Yil boʻyicha: ${yearlySummary.total} ta)` : '100%'],
      ['Vaqtida bajarildi', `${summary.ok} ta`, `${sOkPct}%`],
      ['Jarayonda', `${summary.prog} ta`, `${sProgPct}%`],
      ['Muddatdan oshdi', `${summary.late} ta`, `${sLatePct}%`],
      ['Biriktirilmagan', `${summary.new} ta`, `${sNewPct}%`],
      ['Bajarilish samaradorligi', `${summary.pct}%`, 'Umumiy ijro darajasi'],
      ['Oʻrtacha bajarilish muddati', `${summary.avg_days} kun`, 'Yopilgan topshiriqlar boʻyicha'],
      ['Jami hujjatlar soni', `${docCount} ta`, 'Hisobotdagi hujjatlar'],
    ],
    [5200, 3200, 6998],
  );

  let secNo = 2;
  let orgSection = '';
  if (orgStats.length) {
    const orgTable = wTable(
      ['Tashkilot', 'Jami', 'Vaqtida bajarildi', 'Jarayonda', 'Muddatdan oshdi', 'Samaradorlik'],
      orgStats.map((o) => [o.name, `${o.total} ta`, `${o.ok} ta`, `${o.prog} ta`, `${o.late} ta`, `${o.pct}%`]),
      [5398, 1800, 2200, 2000, 2200, 1800],
    );
    orgSection = `<w:p><w:pPr><w:spacing w:before="240" w:after="80"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t>${secNo}. Tashkilotlar boʻyicha koʻrsatkichlar</w:t></w:r></w:p>${orgTable}`;
    secNo += 1;
  }

  let userSection = '';
  if (userStats.length) {
    const userTable = wTable(
      ['Xodim', 'Jami', 'Vaqtida bajarildi', 'Jarayonda', 'Muddatdan oshdi', 'Samaradorlik'],
      userStats.map((u) => [u.name, `${u.total} ta`, `${u.ok} ta`, `${u.prog} ta`, `${u.late} ta`, `${u.pct}%`]),
      [5398, 1800, 2200, 2000, 2200, 1800],
    );
    userSection = `<w:p><w:pPr><w:spacing w:before="240" w:after="80"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t>${secNo}. Xodimlar boʻyicha koʻrsatkichlar</w:t></w:r></w:p>${userTable}`;
    secNo += 1;
  }

  const docRows = rows.map((r, i) => {
    const orgDept = r.department && r.department !== '—' ? `${r.org} / ${r.department}` : r.org;
    const timeline = r.doneDate && r.doneDate !== '—' ? `${r.deadline} → ${r.doneDate}` : r.deadline;
    return [
      String(i + 1),
      `${r.number} (${r.type})`,
      orgDept,
      r.docTitle,
      r.priorityLabel || '—',
      r.taskTitle || r.docTitle,
      r.assignee,
      r.viewedAt || 'Koʻrilmagan',
      timeline,
      r.statusLabel,
    ];
  });
  const mainTable = wTable(
    ['№', 'Hujjat va turi', 'Tashkilot / Boʻlim', 'Mazmuni', 'Muhimlik', 'Topshiriq', 'Bajaruvchi', 'Koʻrilgan vaqt', 'Muddat / Bajarildi', 'Holat'],
    docRows.length ? docRows : [['—', '—', '—', 'Tanlangan filtr boʻyicha topshiriqlar topilmadi', '—', '—', '—', '—', '—', '—']],
    [500, 1400, 2200, 2500, 1100, 2198, 1900, 1200, 1300, 1100],
  );

  const mainTitle = `${secNo}. Hujjatlar va topshiriqlar ijrosi`;
  const metaLine = `Davr: ${periodLabel} · Shakllantirildi: ${generatedAt}${filterNote ? ' · Filtr: ' + filterNote : ''}`;

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:spacing w:after="100"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="1F4E78"/><w:sz w:val="32"/></w:rPr><w:t xml:space="preserve">${xmlEsc(title)}</w:t></w:r></w:p>
    <w:p><w:pPr><w:spacing w:after="200"/></w:pPr><w:r><w:rPr><w:color w:val="64748B"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${xmlEsc(metaLine)}</w:t></w:r></w:p>
    <w:p><w:pPr><w:spacing w:before="120" w:after="80"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t>1. Umumiy ijro statistikasi</w:t></w:r></w:p>
    ${statTable}
    ${orgSection}
    ${userSection}
    <w:p><w:pPr><w:spacing w:before="240" w:after="80"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t>${mainTitle}</w:t></w:r></w:p>
    ${mainTable}
    <w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>
  </w:body>
</w:document>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
</w:styles>`;

  const settingsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="708"/></w:settings>`;

  const fontTableXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:font w:name="Calibri"><w:charset w:val="00"/><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font></w:fonts>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  <Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>
  <Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
</Relationships>`;

  return makeZip([
    { name: '[Content_Types].xml', content: contentTypes },
    { name: '_rels/.rels', content: rootRels },
    { name: 'docProps/core.xml', content: corePropsXml() },
    { name: 'docProps/app.xml', content: appPropsXml('Microsoft Office Word') },
    { name: 'word/document.xml', content: documentXml },
    { name: 'word/styles.xml', content: stylesXml },
    { name: 'word/settings.xml', content: settingsXml },
    { name: 'word/fontTable.xml', content: fontTableXml },
    { name: 'word/theme/theme1.xml', content: MIN_THEME_XML },
    { name: 'word/_rels/document.xml.rels', content: docRels },
  ]);
}
