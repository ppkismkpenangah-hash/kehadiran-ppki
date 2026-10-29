// ====== Konfigurasi Sumber Data ======
const SHEET_ID = "1SrFdMtbcNu6C_ky60dAGQrBKpA5rSaik5NIOLs_X6-E";
const GID_MOEIS = "1548224094";      // Kehadiran Bulanan (kelas)
const GID_INDIVIDU = "512680035";    // Kehadiran Individu Murid

const MONTHS = ["Januari","Februari","Mac","April","Mei","Jun","Julai","Ogos","September","Oktober","November","Disember"];

function gvizUrl(gid) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?gid=${gid}&tqx=out:json`;
}

// Fetch + parse a Google Sheet tab via the visualization API (works for "anyone with link" viewer access)
async function fetchSheetTable(gid) {
  const res = await fetch(gvizUrl(gid), { cache: "no-store" });
  if (!res.ok) throw new Error("Gagal capai Google Sheet (" + res.status + ")");
  const text = await res.text();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const json = JSON.parse(text.substring(start, end + 1));
  const cols = json.table.cols.map(c => (c.label || "").trim());
  const rows = json.table.rows.map(r =>
    r.c.map(cell => {
      if (!cell) return null;
      if (cell.v === null || cell.v === undefined) return null;
      return cell.v;
    })
  );
  return { cols, rows };
}

// Parse a "hadir/jumlah" text cell -> {hadir, jumlah} or null if blank/invalid
function parseFraction(cellVal) {
  if (cellVal === null || cellVal === undefined) return null;
  const str = String(cellVal).trim();
  if (str === "") return null;
  const parts = str.split("/");
  if (parts.length !== 2) return null;
  const hadir = parseFloat(parts[0]);
  const jumlah = parseFloat(parts[1]);
  if (isNaN(hadir) || isNaN(jumlah) || jumlah === 0) return null;
  return { hadir, jumlah };
}

// Sum hadir/jumlah across an array of "x/y" cells, return overall percent (0-100) or null
function overallPercent(fractionCells) {
  let sumHadir = 0, sumJumlah = 0;
  fractionCells.forEach(c => {
    const f = parseFraction(c);
    if (f) { sumHadir += f.hadir; sumJumlah += f.jumlah; }
  });
  if (sumJumlah === 0) return null;
  return (sumHadir / sumJumlah) * 100;
}

function pctClass(pct) {
  if (pct === null) return "";
  if (pct >= 90) return "good";
  if (pct >= 75) return "warn";
  return "bad";
}

function fmtPct(pct) {
  if (pct === null || pct === undefined || isNaN(pct)) return "—";
  return pct.toFixed(1) + "%";
}

// ====== Load Kehadiran Bulanan (kelas) ======
// Returns [{bil, bulan, hadir, jumlah, pct}] for the 12 months (Jan-Dis), ignoring the summary row
async function loadMonthlyClass() {
  const { rows } = await fetchSheetTable(GID_MOEIS);
  const out = [];
  for (const r of rows) {
    const bulanRaw = r[1];
    if (!bulanRaw) continue;
    const bulanStr = String(bulanRaw);
    const matchedMonth = MONTHS.find(m => bulanStr.indexOf(m) === 0);
    if (!matchedMonth) continue; // skip summary/blank rows
    const hadir = (r[2] === null || r[2] === undefined) ? null : Number(r[2]);
    const jumlah = (r[3] === null || r[3] === undefined) ? null : Number(r[3]);
    const pct = (hadir !== null && jumlah) ? (hadir / jumlah) * 100 : null;
    out.push({ bulan: matchedMonth, hadir, jumlah, pct });
  }
  return out;
}

// ====== Load Kehadiran Individu ======
// Returns [{bil, nama, ic, months:[cellstr x12], pct}]
async function loadIndividualStudents() {
  const { rows } = await fetchSheetTable(GID_INDIVIDU);
  const out = [];
  for (const r of rows) {
    // Murid sebenar = baris jadual atas sahaja: mesti ada BIL (nombor) di lajur A dan nama di lajur B.
    // Baris ringkasan di bawah (TAHUN, NOMBOR BULAN, HARI ADA REKOD, dsb.) tiada BIL, jadi diabaikan.
    const bil = r[0];
    const nama = r[1];
    if (!nama) continue;
    if (bil === null || bil === undefined || isNaN(Number(bil)) || String(bil).trim() === "") continue;
    const ic = r[2] !== null && r[2] !== undefined ? String(r[2]).trim() : "";
    const months = [];
    for (let i = 0; i < 12; i++) {
      months.push(r[3 + i] !== undefined ? r[3 + i] : null);
    }
    const pct = overallPercent(months);
    out.push({ nama: String(nama).trim(), ic, months, pct });
  }
  return out;
}

// Bilangan bulan yang ada data: bulan (Jan-Dis) di mana sekurang-kurangnya seorang murid ada rekod "hadir/jumlah"
function countMonthsWithData(students) {
  let count = 0;
  for (let i = 0; i < 12; i++) {
    if (students.some(s => parseFraction(s.months[i]))) count++;
  }
  return count;
}

function findStudentByIC(students, icQuery) {
  const q = String(icQuery).replace(/[\s-]/g, "");
  return students.find(s => s.ic.replace(/[\s-]/g, "") === q);
}

// ====== Lightweight inline SVG charts (no external dependency) ======

function svgLineChart(points, opts) {
  // points: [{label, value}], value in 0-100 or null
  opts = opts || {};
  const w = opts.width || 640, h = opts.height || 220;
  const padL = 34, padR = 16, padT = 16, padB = 34;
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const n = points.length;
  const stepX = n > 1 ? innerW / (n - 1) : 0;
  const yFor = v => padT + innerH - (v / 100) * innerH;
  const xFor = i => padL + stepX * i;

  let gridLines = "";
  [0, 25, 50, 75, 100].forEach(v => {
    const y = yFor(v);
    gridLines += `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="#E3DFD3" stroke-width="1"/>`;
    gridLines += `<text x="${padL - 8}" y="${y + 4}" font-size="10" fill="#6B7280" text-anchor="end">${v}%</text>`;
  });

  let pathD = "";
  let dots = "";
  let valueLabels = "";
  let started = false;
  points.forEach((p, i) => {
    if (p.value === null || p.value === undefined) { started = false; return; }
    const x = xFor(i), y = yFor(p.value);
    pathD += (started ? " L" : " M") + x + "," + y;
    started = true;
    dots += `<circle cx="${x}" cy="${y}" r="3.5" fill="#C9A227" stroke="#1F3864" stroke-width="1.2"/>`;
    // Label peratus di atas titik; jika terlalu tinggi (dekat 100%), letak di bawah supaya tak terpotong
    const labelY = p.value >= 92 ? y + 16 : y - 9;
    valueLabels += `<text x="${x}" y="${labelY}" font-size="10.5" font-weight="600" fill="#13233F" text-anchor="middle">${p.value.toFixed(1)}%</text>`;
  });

  let labels = "";
  points.forEach((p, i) => {
    labels += `<text x="${xFor(i)}" y="${h - 10}" font-size="10" fill="#6B7280" text-anchor="middle">${p.label.slice(0,3)}</text>`;
  });

  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Carta trend kehadiran">
    ${gridLines}
    <path d="${pathD}" fill="none" stroke="#1F3864" stroke-width="2.5"/>
    ${dots}
    ${valueLabels}
    ${labels}
  </svg>`;
}

function svgBarChart(points, opts) {
  // points: [{label, value}]
  opts = opts || {};
  const w = opts.width || 640;
  const barH = opts.barHeight || 26;
  const gap = opts.gap || 10;
  const padL = opts.labelWidth || 150, padR = 60, padT = 8;
  const n = points.length;
  const h = padT * 2 + n * (barH + gap) - gap;
  const innerW = w - padL - padR;

  let bars = "";
  points.forEach((p, i) => {
    const y = padT + i * (barH + gap);
    const val = p.value || 0;
    const bw = Math.max(2, (val / 100) * innerW);
    const color = val >= 90 ? "#2E7D46" : val >= 75 ? "#C9A227" : "#B3382C";
    bars += `<text x="${padL - 10}" y="${y + barH / 2 + 4}" font-size="12.5" fill="#1B1E23" text-anchor="end">${p.label}</text>`;
    bars += `<rect x="${padL}" y="${y}" width="${innerW}" height="${barH}" rx="5" fill="#F0EEE6"/>`;
    bars += `<rect x="${padL}" y="${y}" width="${bw}" height="${barH}" rx="5" fill="${color}"/>`;
    bars += `<text x="${padL + innerW + 8}" y="${y + barH / 2 + 4}" font-size="12.5" fill="#1B1E23">${p.value === null ? "—" : p.value.toFixed(1) + "%"}</text>`;
  });

  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Carta perbandingan kehadiran murid">${bars}</svg>`;
}
