'use strict';
// B10 · Dashboard KPIs + Excel/PDF export (FR-22 FR-23 · BR-25 BR-26 · DECISIONS §12 §18 · CONTRACT §2.9 §6.4 §7 · TEST-DATA §7)
// Page : GET /dashboard (executive) ?period=2026-12|2026&service=ALL|SV-01..
// API  : GET /api/dashboard?period=&service=  → {received,closed,onTime,ontimePct,backlog,overdue,workload:[{username,count}]}
//        GET /api/dashboard/export?format=xlsx|pdf&period=&service=  → file + Audit EXPORT "<format> <period> <service>"
// Rules:
//   received  = cases with a case number whose paid_at is in the period (CANCELLED included)
//   closed    = COMPLETED + REJECTED whose closed_at is in the period
//   onTime    = closed with closed_at <= due_at (16:30:00 itself counts)
//   ontimePct = onTime / closed × 100, 1 decimal, half-up · closed 0 → null / "–"
//   backlog   = SUBMITTED+IN_REVIEW+NEED_FIX+PENDING_APPROVAL+APPROVED "as of now" (independent of period, A-41)
//   overdue   = backlog not NEED_FIX with now > due_at
//   yearly    = sums of all months, % from totals (never average of monthly %)
// BUG_MODE B10: ontimePct divides by "received" instead of "closed".
// No personal data anywhere (BR-24): only counts + staff usernames.
const fs = require('fs');

module.exports = function register(app, ctx) {
  const { db, clock, time, bugMode, audit, errors, guard } = ctx;
  const { AppError } = errors;

  const BACKLOG = ['SUBMITTED', 'IN_REVIEW', 'NEED_FIX', 'PENDING_APPROVAL', 'APPROVED'];
  const CLOSED = ['COMPLETED', 'REJECTED'];
  const DASH = '–'; // en dash "–" (CONTRACT §0)
  const LABELS = ['รับเรื่อง', 'ปิดงาน', 'ทันกำหนด %', 'งานคงค้าง', 'เกินกำหนดคงค้าง'];
  const TH_MONTHS_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

  const ms = (v) => (v ? time.toDate(v).getTime() : NaN);
  const pad2 = (n) => String(n).padStart(2, '0');

  /** Bangkok "YYYY-MM" of a stored time (null if empty) */
  function monthKey(v) {
    if (!v) return null;
    const p = time.parts(v);
    return `${p.y}-${pad2(p.m)}`;
  }
  const inPeriod = (v, period) => {
    const k = monthKey(v);
    return !!k && (period.length === 4 ? k.slice(0, 4) === period : k === period);
  };

  function defaultPeriod() {
    return monthKey(clock.now());
  }

  function serviceIds() {
    return db.prepare('SELECT id FROM services ORDER BY sort, id').all().map((r) => r.id);
  }

  /** Validate filters. strict → throw BAD_REQUEST (API); otherwise fall back to defaults (page). */
  function parseFilters(q, strict) {
    let period = typeof q.period === 'string' ? q.period.trim() : '';
    let service = typeof q.service === 'string' ? q.service.trim().toUpperCase() : '';
    const okPeriod = /^\d{4}$/.test(period) || (/^\d{4}-(0[1-9]|1[0-2])$/.test(period));
    if (!period) period = defaultPeriod();
    else if (!okPeriod) { if (strict) throw new AppError('BAD_REQUEST'); period = defaultPeriod(); }
    if (!service) service = 'ALL';
    else if (service !== 'ALL' && !serviceIds().includes(service)) {
      if (strict) throw new AppError('BAD_REQUEST');
      service = 'ALL';
    }
    return { period, service };
  }

  /** half-up to 1 decimal using integer arithmetic (6/7 → 85.7 · 2/3 → 66.7) */
  function pct(num, den) {
    if (!den) return null;
    return Math.round((num * 1000) / den) / 10;
  }
  const pctText = (p) => (p === null ? DASH : p.toFixed(1) + '%');

  function compute({ period, service }) {
    const rows = db.prepare(
      'SELECT service_id, status, case_no, owner, paid_at, due_at, closed_at FROM cases' +
      (service === 'ALL' ? '' : ' WHERE service_id = ?'),
    ).all(...(service === 'ALL' ? [] : [service]));
    const now = clock.now().getTime();

    let received = 0, closed = 0, onTime = 0, backlog = 0, overdue = 0;
    const holding = new Map();
    for (const r of rows) {
      if (r.case_no && r.paid_at && inPeriod(r.paid_at, period)) received++;
      if (CLOSED.includes(r.status) && inPeriod(r.closed_at, period)) {
        closed++;
        if (r.due_at && ms(r.closed_at) <= ms(r.due_at)) onTime++;
      }
      if (BACKLOG.includes(r.status)) {
        backlog++;
        if (r.status !== 'NEED_FIX' && r.due_at && now > ms(r.due_at)) overdue++;
      }
    }
    // A-41: officer workload ignores the service (and period) filter — always all IN_REVIEW cases
    for (const r of db.prepare("SELECT owner, COUNT(*) AS n FROM cases WHERE status = 'IN_REVIEW' AND owner IS NOT NULL GROUP BY owner").all()) {
      holding.set(r.owner, r.n);
    }
    const ontimePct = bugMode('B10') ? pct(onTime, received) : pct(onTime, closed);
    const workload = db.prepare("SELECT username FROM staff WHERE role = 'officer' ORDER BY username").all()
      .map((s) => ({ username: s.username, count: holding.get(s.username) || 0 }));
    return { period, service, received, closed, onTime, ontimePct, backlog, overdue, workload };
  }

  /** the 5 values exactly as shown on screen (strings) */
  function displayValues(k) {
    return [String(k.received), String(k.closed), pctText(k.ontimePct), String(k.backlog), String(k.overdue)];
  }

  function periodLabel(period) {
    if (period.length === 4) return `ทั้งปี ${Number(period) + 543}`;
    const [y, m] = period.split('-').map(Number);
    return `${TH_MONTHS_FULL[m - 1]} ${y + 543}`;
  }

  /** months from the earliest paid/closed month (or Jan of the clock year) up to the clock month, newest first, then years */
  function periodOptions(selected) {
    const cur = defaultPeriod();
    const first = db.prepare('SELECT MIN(paid_at) AS a FROM cases WHERE paid_at IS NOT NULL').get().a;
    let start = first ? monthKey(first) : cur;
    const jan = cur.slice(0, 4) + '-01';
    if (start > jan) start = jan;
    const months = [];
    let [y, m] = cur.split('-').map(Number);
    for (;;) {
      const k = `${y}-${pad2(m)}`;
      months.push(k);
      if (k <= start) break;
      m -= 1; if (m === 0) { m = 12; y -= 1; }
    }
    const years = [...new Set(months.map((k) => k.slice(0, 4)))];
    const all = [...months, ...years];
    if (!all.includes(selected)) all.push(selected);
    return all.map((v) => ({ value: v, label: periodLabel(v) }));
  }

  // ───────────────────────── export ─────────────────────────
  async function buildXlsx(k) {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'e-Service';
    const ws = wb.addWorksheet('Dashboard');
    ws.columns = [{ width: 22 }, { width: 14 }];
    ws.addRow(['ตัวชี้วัด', 'ค่า']).font = { bold: true };
    const vals = displayValues(k);
    LABELS.forEach((label, i) => {
      const row = ws.addRow([label, vals[i]]);
      row.getCell(2).numFmt = '@'; // text, exactly as on screen
      row.getCell(2).alignment = { horizontal: 'right' };
    });
    ws.addRow([]);
    ws.addRow(['ช่วง', k.period]);
    ws.addRow(['บริการ', k.service]);
    const ws2 = wb.addWorksheet('งานในมือ');
    ws2.columns = [{ width: 18 }, { width: 10 }];
    ws2.addRow(['เจ้าหน้าที่', 'งานในมือ']).font = { bold: true };
    k.workload.forEach((w) => ws2.addRow([w.username, String(w.count)]));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  const THAI_FONT_CANDIDATES = [
    process.env.PDF_THAI_FONT,
    '/usr/share/fonts/truetype/tlwg/Garuda.ttf',
    '/usr/share/fonts/truetype/tlwg/Loma.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf',
  ].filter(Boolean);
  const thaiFont = THAI_FONT_CANDIDATES.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });

  function buildPdf(k) {
    const PDFDocument = require('pdfkit');
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Dashboard ${k.period} ${k.service}` } });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      const v = displayValues(k);
      doc.font('Helvetica-Bold').fontSize(16).text('e-Service Dashboard');
      doc.font('Helvetica').fontSize(11).text(`period=${k.period} service=${k.service}`);
      doc.moveDown();
      // machine-readable line (CONTRACT §7) — ASCII only, its own line
      const ontime = k.ontimePct === null ? '-' : k.ontimePct.toFixed(1) + '%';
      doc.font('Helvetica').fontSize(12)
        .text(`kpi received=${k.received} closed=${k.closed} ontime=${ontime} backlog=${k.backlog} overdue=${k.overdue}`);
      doc.moveDown();
      if (thaiFont) {
        try {
          doc.font(thaiFont).fontSize(12);
          doc.text(`ช่วง: ${periodLabel(k.period)} · บริการ: ${k.service === 'ALL' ? 'ทั้งหมด' : k.service}`);
          LABELS.forEach((label, i) => doc.text(`${label}: ${v[i]}`));
        } catch { /* Thai labels are optional (A-63) */ }
      }
      doc.moveDown();
      doc.font('Helvetica').fontSize(11).text('workload (IN_REVIEW per officer):');
      k.workload.forEach((w) => doc.text(`${w.username}: ${w.count}`));
      doc.end();
    });
  }

  // ───────────────────────── routes ─────────────────────────
  app.get('/api/dashboard', guard.api('executive'), (req, res) => {
    const k = compute(parseFilters(req.query, true));
    res.set('Cache-Control', 'no-store');
    res.json({
      received: k.received, closed: k.closed, onTime: k.onTime, ontimePct: k.ontimePct,
      backlog: k.backlog, overdue: k.overdue, workload: k.workload,
      period: k.period, service: k.service,
    });
  });

  app.get('/api/dashboard/export', guard.api('executive'), async (req, res, next) => {
    try {
      const format = typeof req.query.format === 'string' ? req.query.format.trim().toLowerCase() : '';
      if (format !== 'xlsx' && format !== 'pdf') throw new AppError('BAD_REQUEST');
      const f = parseFilters(req.query, true);
      const k = compute(f);
      const buf = format === 'xlsx' ? await buildXlsx(k) : await buildPdf(k);
      audit.log({ user: req.user, event: 'EXPORT', detail: `${format} ${f.period} ${f.service}` });
      const name = `dashboard-${f.period}-${f.service}.${format}`;
      res.set('Content-Type', format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="${name}"`);
      res.set('Cache-Control', 'no-store');
      res.send(buf);
    } catch (e) { next(e); }
  });

  app.get('/dashboard', guard.page('executive'), (req, res) => {
    const f = parseFilters(req.query, false);
    const k = compute(f);
    res.render('dashboard', {
      title: 'Dashboard',
      k, values: displayValues(k), labels5: LABELS,
      periods: periodOptions(f.period),
      services: serviceIds(),
    });
  });
};
