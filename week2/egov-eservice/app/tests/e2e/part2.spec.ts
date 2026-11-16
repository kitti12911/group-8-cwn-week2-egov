import AxeBuilder from '@axe-core/playwright';
import ExcelJS from 'exceljs';
import {
  test, expect, App, type Session, NOW, SOMCHAI, SOMYING, MANA, caseNo, masked,
  reasonError, json, get, post, put, error, row, text, state, buttons, openCase,
  caseAction, returnUI, rejectUI, auditFilter, download, noPersonalData, noIdKeys,
  keyboardJourney, checkStatusLabels, inspectStorage,
} from './helpers2';

// TEST-PLAN §§9–16: exactly one test per TC, with literal specification oracles.
// Server-wide RESET means the shared Playwright config must use workers: 1.
test.describe.configure({ mode: 'default' });

const dashboardPath = '/api/dashboard?period=2026-12&service=ALL';
const pairs = (items: { caseNo: string; level: string }[]) =>
  items.map(x => `${x.caseNo}:${x.level}`).sort();
const expectedPairs = (near: number[], overdue: number[]) =>
  [...near.map(n => `${caseNo(n)}:near`), ...overdue.map(n => `${caseNo(n)}:overdue`)].sort();
async function notifications(app: App, username: string, near?: number[], overdue?: number[]) {
  const s = await app.staff(username);
  await s.page.goto('/notifications');
  const body = await get(s, '/api/notifications');
  await expect(s.page.getByTestId('noti-item')).toHaveCount(body.items.length);
  await text(s.page, 'bell-count', body.items.length);
  const uiPairs = await s.page.getByTestId('noti-item').evaluateAll(els => els.map(el =>
    `${el.getAttribute('data-case-no')}:${el.getAttribute('data-level')}`).sort());
  expect(uiPairs).toEqual(pairs(body.items));
  expect(new Set(uiPairs).size).toBe(uiPairs.length);
  if (near && overdue) expect(uiPairs).toEqual(expectedPairs(near, overdue));
  for (const item of body.items) {
    const el = s.page.locator(`[data-testid="noti-item"][data-case-no="${item.caseNo}"][data-level="${item.level}"]`);
    await expect(el).toHaveText(`คำขอ ${item.caseNo} ${item.level === 'near' ? 'ใกล้ครบกำหนด' : 'เกินกำหนด'}`);
    expect(item.text).toBe(`คำขอ ${item.caseNo} ${item.level === 'near' ? 'ใกล้ครบกำหนด' : 'เกินกำหนด'}`);
  }
  if (!body.items.length) await text(s.page, 'noti-empty', 'ไม่มีแจ้งเตือน');
  return { s, items: body.items as { caseNo: string; level: string }[] };
}
async function notificationCase(app: App, user: string, n: number, levels: string[]) {
  const { items } = await notifications(app, user);
  expect(items.filter(x => x.caseNo === caseNo(n)).map(x => x.level).sort()).toEqual([...levels].sort());
}
async function verify(s: Session, code: string, result: string, expiry?: string) {
  const response = await s.page.goto(`/verify/${code}`);
  expect(response?.status()).toBe(result === 'NOT_FOUND' ? 404 : 200);
  const labels: Record<string, string> = {
    VALID: 'เอกสารถูกต้อง', EXPIRED: 'เอกสารหมดอายุ', TAMPERED: 'ลายเซ็นไม่ถูกต้อง', NOT_FOUND: 'ไม่พบเอกสาร',
  };
  await text(s.page, 'verify-result', labels[result]);
  await expect(s.page.getByTestId('verify-result')).toHaveAttribute('data-result', result);
  const body = await get(s, `/api/verify/${code}`, result === 'NOT_FOUND' ? 404 : 200);
  expect(body.result).toBe(result);
  if (expiry) {
    await expect(s.page.getByTestId('verify-expires')).toHaveAttribute('data-iso', expiry);
    expect(body.validUntil).toBe(expiry);
  }
  if (['NOT_FOUND', 'TAMPERED'].includes(result)) {
    await buttons(s.page, { 'verify-doc-no': 0, 'verify-applicant': 0 });
    expect(body).toEqual({ result });
  }
  return body;
}
async function dashboard(s: Session, period: string, service: string,
  received: number, closed: number, pct: string, backlog: number, overdue: number) {
  await s.page.goto('/dashboard');
  await s.page.getByTestId('period-select').selectOption(period);
  await s.page.getByTestId('service-select').selectOption(service);
  for (const [id, value] of Object.entries({
    'kpi-received': received, 'kpi-closed': closed, 'kpi-ontime-pct': pct,
    'kpi-backlog': backlog, 'kpi-overdue': overdue,
  })) await text(s.page, id, value);
  const data = await get(s, `/api/dashboard?period=${period}&service=${service}`);
  expect(data).toMatchObject({ received, closed, ontimePct: pct === '–' ? null : Number(pct.replace('%', '')), backlog, overdue });
  return data;
}

test('TC-NOTI-01 · ผู้รับแจ้งเตือนตามระดับ', async ({ app }) => {
  await notifications(app, 'off.reg1', [24, 22], [20]);
  await notifications(app, 'off.reg2', [24], []);
  await notifications(app, 'head1', [], [20]);
  await notifications(app, 'off.works1', [], []);
  await app.clock('2026-12-01T16:31:00+07:00');
  await notifications(app, 'off.reg1', [24, 22], [20, 22]);
  await notifications(app, 'head1', [], [20, 22]);
  await notifications(app, 'off.reg2', [24], []);
});

test('TC-NOTI-02 · ไม่แจ้งซ้ำ ข้ามระดับ และขั้นรออนุมัติ/รอออกเอกสาร', async ({ app }) => {
  await notifications(app, 'off.reg1', [24, 22], [20]);
  await app.clock('2026-12-01T16:31:00+07:00');
  await notifications(app, 'off.reg1', [24, 22], [20, 22]);
  await notifications(app, 'head1', [], [20, 22]);
  for (const user of ['off.reg1', 'head1']) {
    const s = await app.staff(user);
    for (let i = 0; i < 3; i++) await s.page.goto('/notifications');
    for (let i = 0; i < 3; i++) await get(s, '/api/notifications');
    for (let i = 0; i < 2; i++) await s.page.goto('/officer/queue');
    await notifications(app, user, user === 'off.reg1' ? [24, 22] : [], [20, 22]);
  }
  await app.reset();
  await app.clock('2026-12-05T10:00:00+07:00');
  await notifications(app, 'off.reg1', [], [20, 22, 23, 24, 28, 29, 30]);
  await notifications(app, 'off.reg2', [16], [13, 15, 24, 25, 26, 27, 28, 29, 30]);
  await notifications(app, 'off.works1', [], [10]);
  await notifications(app, 'head1', [11], [10, 13, 14, 15, 20, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
  await app.reset();
  await app.clock('2026-12-04T09:00:00+07:00');
  await notificationCase(app, 'head1', 14, ['near']);
  for (const user of ['off.reg1', 'off.reg2']) await notificationCase(app, user, 14, []);
  await app.clock('2026-12-04T16:31:00+07:00');
  await notificationCase(app, 'head1', 14, ['near', 'overdue']);
  for (const user of ['off.reg1', 'off.reg2']) await notificationCase(app, user, 14, []);
  await app.clock('2026-12-08T09:00:00+07:00');
  await notificationCase(app, 'off.reg1', 19, ['near']);
  for (const user of ['off.reg2', 'head1']) await notificationCase(app, user, 19, []);
  await app.clock('2026-12-09T16:31:00+07:00');
  await notificationCase(app, 'off.reg1', 19, ['near', 'overdue']);
  await notificationCase(app, 'head1', 19, ['overdue']);
});

test('TC-WORKFLOW-01 · SV-01 อนุมัติ + ออกเอกสาร', async ({ app }) => {
  const reg2 = await app.staff('off.reg2');
  await openCase(reg2, 25);
  await state(reg2.page, 'IN_REVIEW');
  await text(reg2.page, 'case-fee', '฿60');
  await buttons(reg2.page, { 'approve-btn': 1, 'return-btn': 1, 'reject-btn': 1, 'forward-btn': 0, 'issue-btn': 0 });
  const reg1 = await app.staff('off.reg1');
  await error(await reg1.api.post(`/api/cases/${caseNo(26)}/approve`), 403, 'FORBIDDEN');
  await reg2.page.getByTestId('approve-btn').click();
  await state(reg2.page, 'APPROVED');
  await buttons(reg2.page, { 'issue-btn': 1, 'approve-btn': 0 });
  await reg2.page.getByTestId('issue-btn').click();
  await state(reg2.page, 'COMPLETED');
  await text(reg2.page, 'doc-no', 'DOC-2569-000002');
  await expect(reg2.page.getByTestId('verify-code')).toHaveText(/^[A-Z0-9]{8}$/);
  await expect(reg2.page.getByTestId('closed-at')).toHaveAttribute('data-iso', NOW);
  await text(reg2.page, 'sla-level', 'ปิดแล้ว');
  const citizen = await app.citizen(SOMYING);
  await openCase(citizen, 25, true);
  await state(citizen.page, 'COMPLETED');
  await buttons(citizen.page, { 'download-doc-btn': 1 });
  const doc = await citizen.api.get('/api/documents/DOC-2569-000002/pdf');
  expect(doc.status()).toBe(200);
  expect(doc.headers()['content-type']).toContain('application/pdf');
  expect(doc.headers()['content-disposition']).toContain('DOC-2569-000002.pdf');
  expect((await doc.body()).toString('latin1')).toContain('docNo=DOC-2569-000002 caseNo=EG-2569-000025');
  const file = await download(citizen.page, 'download-doc-btn');
  expect(file.download.suggestedFilename()).toBe('DOC-2569-000002.pdf');
  expect(file.bytes.length).toBeGreaterThan(0);
  expect(await get(await app.staff('exec1'), dashboardPath)).toMatchObject({ closed: 1, onTime: 1, received: 3, backlog: 20 });
});

test('TC-WORKFLOW-02 · SV-02 ผ่านหัวหน้า', async ({ app }) => {
  const reg2 = await app.staff('off.reg2');
  await openCase(reg2, 13);
  await buttons(reg2.page, { 'approve-btn': 0, 'forward-btn': 1, 'forward-target': 0 });
  await reg2.page.getByTestId('forward-btn').click();
  await state(reg2.page, 'PENDING_APPROVAL');
  // workload-count is contracted on /officer/queue, so verify it there.
  await reg2.page.goto('/officer/queue');
  await text(reg2.page, 'workload-count', 8);
  await expect(row(reg2.page, 'queue-row', 13)).toHaveCount(0);
  const head = await app.staff('head1');
  await head.page.goto('/head/approvals');
  await expect(head.page.getByTestId('approval-row')).toHaveCount(3);
  expect(await head.page.getByTestId('approval-row').evaluateAll(els => els.map(x => x.getAttribute('data-case-no'))))
    .toEqual([caseNo(13), caseNo(14), caseNo(11)]);
  await row(head.page, 'approval-row', 13).getByTestId('approval-open').click();
  await buttons(head.page, { 'approve-btn': 1, 'reject-btn': 1, 'issue-btn': 0 });
  await head.page.getByTestId('approve-btn').click();
  await state(head.page, 'APPROVED');
  await buttons(head.page, { 'issue-btn': 0 });
  const reg1 = await app.staff('off.reg1');
  await openCase(reg1, 13);
  await buttons(reg1.page, { 'issue-btn': 0 });
  await error(await reg1.api.post(`/api/officer/cases/${caseNo(13)}/issue`), 403, 'FORBIDDEN');
  await openCase(reg2, 13);
  await reg2.page.getByTestId('issue-btn').click();
  await state(reg2.page, 'COMPLETED');
  await text(reg2.page, 'doc-no', 'DOC-2569-000002');
  await verify(await app.session(), (await reg2.page.getByTestId('verify-code').innerText()).trim(), 'VALID');
  await text((await app.session()).page, 'verify-signer', 'หัวหน้าฝ่าย');
  await app.reset();
  const seedIssuer = await app.staff('off.reg1');
  await openCase(seedIssuer, 19);
  await seedIssuer.page.getByTestId('issue-btn').click();
  await state(seedIssuer.page, 'COMPLETED');
  await text(seedIssuer.page, 'doc-no', 'DOC-2569-000002');
  await verify(await app.session(), (await seedIssuer.page.getByTestId('verify-code').innerText()).trim(), 'VALID');
  await text((await app.session()).page, 'verify-signer', 'หัวหน้าฝ่าย');
});

test('TC-WORKFLOW-03 · SV-03 สามขั้นตอน', async ({ app }) => {
  const reg2 = await app.staff('off.reg2');
  await openCase(reg2, 12);
  await text(reg2.page, 'case-step', 'ขั้นตอน 1/3 · ฝ่ายทะเบียน');
  await text(reg2.page, 'case-fee', '฿1,010');
  await buttons(reg2.page, { 'forward-btn': 1 });
  await reg2.page.getByTestId('forward-btn').click();
  await state(reg2.page, 'IN_REVIEW');
  await text(reg2.page, 'case-step', 'ขั้นตอน 2/3 · ฝ่ายโยธา');
  await text(reg2.page, 'case-owner', 'ยังไม่มีผู้รับ');
  await reg2.page.goto('/officer/queue');
  await text(reg2.page, 'workload-count', 8);
  await expect(row(reg2.page, 'queue-row', 12)).toHaveCount(0);
  await expect(reg2.page.getByTestId('queue-row')).toHaveCount(16);
  const works = await app.staff('off.works1');
  await works.page.goto('/officer/queue');
  await expect(works.page.getByTestId('queue-row')).toHaveCount(2);
  expect(await works.page.getByTestId('queue-row').evaluateAll(els => els.map(x => x.getAttribute('data-case-no'))))
    .toEqual([caseNo(10), caseNo(12)]);
  await buttons(works.page, { 'claim-btn': 2 });
  const reg1 = await app.staff('off.reg1');
  await error(await reg1.api.post(`/api/officer/cases/${caseNo(12)}/claim`), 403, 'FORBIDDEN');
  await row(works.page, 'queue-row', 12).getByTestId('claim-btn').click();
  await openCase(works, 12);
  await text(works.page, 'case-owner', 'off.works1');
  await works.page.getByTestId('forward-btn').click();
  await state(works.page, 'PENDING_APPROVAL');
  await text(works.page, 'case-step', 'ขั้นตอน 3/3 · หัวหน้าฝ่าย');
  const head = await app.staff('head1');
  await head.page.goto('/head/approvals');
  await expect(head.page.getByTestId('approval-row')).toHaveCount(3);
  await row(head.page, 'approval-row', 12).getByTestId('approval-open').click();
  await head.page.getByTestId('approve-btn').click();
  await state(head.page, 'APPROVED');
  await openCase(works, 12);
  await buttons(works.page, { 'issue-btn': 0 });
  await openCase(reg2, 12);
  await buttons(reg2.page, { 'issue-btn': 1 });
  await reg2.page.getByTestId('issue-btn').click();
  await state(reg2.page, 'COMPLETED');
  const anon = await app.session();
  await verify(anon, (await reg2.page.getByTestId('verify-code').innerText()).trim(), 'VALID');
  await text(anon.page, 'verify-signer', 'หัวหน้าฝ่าย');
});

test('TC-WORKFLOW-04 · ตีกลับสูงสุด 2 ครั้ง และผลหลังครบ', async ({ app }) => {
  for (const n of [20, 23, 13]) {
    if (n !== 20) await app.reset();
    const officer = await app.staff(n === 13 ? 'off.reg2' : 'off.reg1');
    if (n !== 23) {
      await openCase(officer, n);
      await text(officer.page, 'return-count', 0);
      const citizen = await app.citizen();
      for (const count of [1, 2]) {
        await returnUI(officer, n);
        await state(officer.page, 'NEED_FIX');
        await text(officer.page, 'return-count', count);
        await openCase(citizen, n, true);
        await citizen.page.getByTestId('submit-fix-btn').click();
        await state(citizen.page, 'IN_REVIEW');
        expect((await get(officer, `/api/cases/${caseNo(n)}`)).owner).toBe(n === 13 ? 'off.reg2' : 'off.reg1');
      }
    }
    await openCase(officer, n);
    await text(officer.page, 'return-count', 2);
    await buttons(officer.page, { 'return-btn': 0, 'approve-btn': n === 13 ? 0 : 1, 'reject-btn': n === 13 ? 0 : 1 });
    await error(await officer.api.post(`/api/officer/cases/${caseNo(n)}/return`, { data: { reason: 'xxxxxxxxxx' } }),
      409, 'RETURN_LIMIT', 'ตีกลับได้สูงสุด 2 ครั้ง');
    expect(await get(officer, `/api/cases/${caseNo(n)}`)).toMatchObject({ status: 'IN_REVIEW', returnCount: 2 });
    if (n === 13) {
      await buttons(officer.page, { 'forward-btn': 1 });
      await error(await officer.api.post(`/api/cases/${caseNo(n)}/reject`, { data: { reason: 'xxxxxxxxxx' } }), 403);
      await officer.page.getByTestId('forward-note').fill('ส่งต่อให้หัวหน้าพิจารณา');
      await officer.page.getByTestId('forward-btn').click();
      await state(officer.page, 'PENDING_APPROVAL');
      const audit = await app.staff('audit1');
      await auditFilter(audit, { event: 'FORWARD' });
      await expect(row(audit.page, 'audit-row', 13).getByTestId('audit-detail')).toContainText('ส่งต่อให้หัวหน้าพิจารณา');
      const head = await app.staff('head1');
      await openCase(head, 13);
      await buttons(head.page, { 'reject-btn': 1, 'approve-btn': 1 });
    }
  }
});

test('TC-WORKFLOW-05 · เหตุผล ≥ 10 ตัวอักษร (ตีกลับ/ไม่อนุมัติ)', async ({ app }) => {
  const reg1 = await app.staff('off.reg1');
  for (const reason of ['xxxxxxxxx', '          ']) {
    await returnUI(reg1, 20, reason);
    await text(reg1.page, 'return-reason-error', reasonError);
    await state(reg1.page, 'IN_REVIEW');
    await error(await reg1.api.post(`/api/officer/cases/${caseNo(20)}/return`, { data: { reason } }), 400, 'REASON_TOO_SHORT');
  }
  await returnUI(reg1, 20);
  await state(reg1.page, 'NEED_FIX');
  const citizen = await app.citizen();
  await openCase(citizen, 20, true);
  await text(citizen.page, 'return-reason-display', 'xxxxxxxxxx');
  await app.reset();
  const reg2 = await app.staff('off.reg2');
  await rejectUI(reg2, 26, 'xxxxxxxxx');
  await text(reg2.page, 'reject-reason-error', reasonError);
  await error(await reg2.api.post(`/api/cases/${caseNo(26)}/reject`, { data: { reason: 'xxxxxxxxx' } }), 400, 'REASON_TOO_SHORT');
  await rejectUI(reg2, 26);
  await state(reg2.page, 'REJECTED');
  await expect(reg2.page.getByTestId('closed-at')).toHaveAttribute('data-iso', NOW);
  await text(reg2.page, 'sla-level', 'ปิดแล้ว');
  const owner = await app.citizen();
  await openCase(owner, 26, true);
  await text(owner.page, 'no-refund-note', 'ค่าธรรมเนียมที่ชำระแล้วไม่คืน');
  expect(await get(await app.staff('exec1'), dashboardPath)).toMatchObject({ closed: 1, onTime: 1 });
  await app.reset();
  const head = await app.staff('head1');
  await error(await head.api.post(`/api/cases/${caseNo(11)}/reject`, { data: { reason: 'xxxxxxxxx' } }), 400, 'REASON_TOO_SHORT');
  expect(await caseAction(head, 11, 'reject', { reason: 'xxxxxxxxxx' })).toMatchObject({ status: 'REJECTED' });
});

test('TC-WORKFLOW-06 · เวลาแก้ไข 168 ชั่วโมง', async ({ app }) => {
  const start = await app.citizen();
  await openCase(start, 17, true);
  await state(start.page, 'NEED_FIX');
  await text(start.page, 'return-reason-display', 'ชื่อในเอกสารไม่ตรงกับบัตร กรุณาแก้ไข');
  await text(start.page, 'fix-deadline', '4 ธ.ค. 2569 14:00');
  await expect(start.page.getByTestId('fix-deadline')).toHaveAttribute('data-iso', '2026-12-04T14:00:00+07:00');
  await buttons(start.page, { 'submit-fix-btn': 1 });
  await app.reset();
  await app.clock('2026-12-04T13:59:00+07:00');
  const before = await app.citizen();
  await openCase(before, 17, true);
  await expect(before.page.getByTestId('submit-fix-btn')).toBeEnabled();
  const submitted = before.page.waitForResponse(r => r.url().endsWith(`/api/cases/${caseNo(17)}/resubmit`) && r.request().method() === 'POST');
  await before.page.getByTestId('submit-fix-btn').click();
  expect((await submitted).status()).toBe(200);
  await state(before.page, 'IN_REVIEW');
  await app.reset();
  await app.clock('2026-12-04T14:00:00+07:00');
  const at = await app.citizen();
  await openCase(at, 17, true);
  await state(at.page, 'CANCELLED');
  await buttons(at.page, { 'submit-fix-btn': 0 });
  await text(at.page, 'no-refund-note', 'ค่าธรรมเนียมที่ชำระแล้วไม่คืน');
  await error(await at.api.post(`/api/cases/${caseNo(17)}/resubmit`), 409);
  await expect(at.page.getByTestId('case-timeline').locator('[data-testid="timeline-item"][data-iso="2026-12-04T14:00:00+07:00"]')).toHaveCount(1);
  expect((await get(await app.staff('exec1'), dashboardPath)).backlog).toBe(20);
});

test('TC-DOC-01 · ออกเอกสารและข้อมูลใน PDF', async ({ app }) => {
  const reg2 = await app.staff('off.reg2');
  await caseAction(reg2, 25, 'approve');
  const issued = await caseAction(reg2, 25, 'issue');
  expect(issued).toMatchObject({ docNo: 'DOC-2569-000002', status: 'COMPLETED' });
  expect(issued.verifyCode).toMatch(/^[A-Z0-9]{8}$/);
  const owner = await app.citizen(SOMYING);
  const pdf = await owner.api.get('/api/documents/DOC-2569-000002/pdf');
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  expect(pdf.headers()['content-disposition']).toContain('DOC-2569-000002.pdf');
  expect((await pdf.body()).toString('latin1')).toContain(
    `docNo=DOC-2569-000002 caseNo=EG-2569-000025 verify=${issued.verifyCode} validUntil=2027-02-28`);
  const anon = await app.session();
  const result = await verify(anon, issued.verifyCode, 'VALID', '2027-02-28');
  expect(result.issuedAt).toBe(NOW);
  for (const [id, value] of Object.entries({
    'verify-doc-no': 'DOC-2569-000002', 'verify-applicant': 'สมหญิง ร***',
    'verify-service': 'SV-01 ขอหนังสือรับรอง', 'verify-signer': 'เจ้าหน้าที่ทะเบียน 2',
  })) await text(anon.page, id, value);
  await expect(anon.page.getByTestId('verify-issued')).toHaveAttribute('data-iso', NOW);
  await openCase(reg2, 25);
  await expect(reg2.page.getByTestId('doc-qr')).toHaveAttribute('data-url', `${app.baseURL.replace(/\/$/, '')}/verify/${issued.verifyCode}`);
  const other = await app.citizen();
  expect((await other.api.get('/api/documents/DOC-2569-000002/pdf')).status()).toBe(404);
  await error(await reg2.api.post(`/api/officer/cases/${caseNo(25)}/issue`), 409, 'INVALID_STATE');
  // A failed repeat must not consume a document number.
  const reg1 = await app.staff('off.reg1');
  expect((await caseAction(reg1, 19, 'issue')).docNo).toBe('DOC-2569-000003');
});

test('TC-DOC-02 · ตรวจเอกสาร /verify', async ({ app }) => {
  const anon = await app.session();
  const body = await verify(anon, 'K7M2Q9XA', 'VALID', '2027-02-02');
  expect(body).toMatchObject({ result: 'VALID', applicantMasked: 'สมชาย ใ***' });
  for (const [id, value] of Object.entries({
    'verify-doc-no': 'DOC-2569-000001', 'verify-applicant': 'สมชาย ใ***',
    'verify-service': 'SV-01 ขอหนังสือรับรอง', 'verify-signer': 'เจ้าหน้าที่ทะเบียน 1',
  })) await text(anon.page, id, value);
  await expect(anon.page.getByTestId('verify-issued')).toHaveAttribute('data-iso', '2026-11-05T10:00:00+07:00');
  expect(anon.page.url()).toContain('/verify/K7M2Q9XA');
  const content = await anon.page.locator('body').innerText();
  expect(content).not.toContain('ใจดี');
  expect(content).not.toContain(SOMCHAI);
  await verify(anon, 'ZZZZZZZZ', 'NOT_FOUND');
});

test('TC-DOC-03 · เอกสารหมดอายุและลายเซ็นไม่ตรง', async ({ app }) => {
  const reg2 = await app.staff('off.reg2');
  await caseAction(reg2, 25, 'approve');
  const c1 = (await caseAction(reg2, 25, 'issue')).verifyCode;
  await app.clock('2027-02-28T23:59:00+07:00');
  await verify(await app.session(), c1, 'VALID', '2027-02-28');
  await app.clock('2027-03-01T00:00:00+07:00');
  await verify(await app.session(), c1, 'EXPIRED', '2027-02-28');
  await app.reset();
  const c2 = (await caseAction(await app.staff('off.reg1'), 19, 'issue')).verifyCode;
  await app.clock('2027-11-30T23:59:00+07:00');
  await verify(await app.session(), c2, 'VALID', '2027-11-30');
  await app.clock('2027-12-01T00:00:00+07:00');
  await verify(await app.session(), c2, 'EXPIRED', '2027-11-30');
  await app.reset();
  await app.clock('2027-02-02T23:59:00+07:00');
  await verify(await app.session(), 'K7M2Q9XA', 'VALID', '2027-02-02');
  await app.clock('2027-02-03T00:00:00+07:00');
  await verify(await app.session(), 'K7M2Q9XA', 'EXPIRED', '2027-02-02');
  await app.reset();
  await app.clock('2028-02-29T10:00:00+07:00');
  const leapReg2 = await app.staff('off.reg2');
  await caseAction(leapReg2, 25, 'approve');
  const leap1 = await caseAction(leapReg2, 25, 'issue');
  const leap2 = await caseAction(await app.staff('off.reg1'), 19, 'issue');
  expect(leap1.docNo).toBe('DOC-2571-000001');
  expect(leap2.docNo).toBe('DOC-2571-000002');
  for (const [now, code, result, expires] of [
    ['2028-05-28T23:59:00+07:00', leap1.verifyCode, 'VALID', '2028-05-28'],
    ['2028-05-29T00:00:00+07:00', leap1.verifyCode, 'EXPIRED', '2028-05-28'],
    ['2029-02-27T23:59:00+07:00', leap2.verifyCode, 'VALID', '2029-02-27'],
    ['2029-02-28T00:00:00+07:00', leap2.verifyCode, 'EXPIRED', '2029-02-27'],
  ]) {
    await app.clock(now);
    await verify(await app.session(), code, result, expires);
  }
  await app.reset();
  expect(await json(await (await app.raw()).post('/api/test/documents/DOC-2569-000001/tamper'))).toEqual({ ok: true });
  await verify(await app.session(), 'K7M2Q9XA', 'TAMPERED');
  await app.clock('2027-03-01T00:00:00+07:00');
  await verify(await app.session(), 'K7M2Q9XA', 'TAMPERED');
});

test('TC-PDPA-01 · ปิดบังเลขบัตรบนจอ', async ({ app }) => {
  const reg2 = await app.staff('off.reg2');
  await reg2.page.goto('/officer/queue');
  for (const id of await reg2.page.getByTestId('row-id-masked').all()) await expect(id).toHaveText(masked);
  await expect(row(reg2.page, 'queue-row', 25).getByTestId('row-id-masked')).toHaveText('X-XXXX-XXXXX-65-9');
  await expect(row(reg2.page, 'queue-row', 26).getByTestId('row-id-masked')).toHaveText('X-XXXX-XXXXX-45-6');
  await openCase(reg2, 25);
  await text(reg2.page, 'applicant-id', 'X-XXXX-XXXXX-65-9');
  const html = await reg2.page.content();
  expect(html).not.toContain(SOMYING);
  expect(html).not.toContain('3-1006-00987-65-9');
  const head = await app.staff('head1');
  await openCase(head, 25);
  await text(head.page, 'applicant-id', 'X-XXXX-XXXXX-65-9');
  const woman = await app.citizen(SOMYING);
  await openCase(woman, 25, true);
  await text(woman.page, 'case-id-full', '3-1006-00987-65-9');
  const man = await app.citizen();
  await openCase(man, 20, true);
  await text(man.page, 'case-id-full', '1-1017-00123-45-6');
});

test('TC-PDPA-02 · API JSON ไม่ส่งเลขบัตรเต็ม', async ({ app }) => {
  for (const username of ['off.reg1', 'head1']) {
    const s = await app.staff(username);
    for (const path of [
      '/api/officer/queue?filter=all', `/api/cases/${caseNo(25)}`, `/api/cases/${caseNo(26)}`,
      `/api/cases/${caseNo(20)}`, '/api/notifications', `/api/cases/${caseNo(25)}/files`,
    ]) {
      const data = await get(s, path);
      const serialized = JSON.stringify(data);
      expect(serialized).not.toMatch(/\d{13}|\d-\d{4}-\d{5}-\d{2}-\d/);
      for (const raw of [SOMYING, SOMCHAI, '1909900555015']) expect(serialized).not.toContain(raw);
      noIdKeys(data);
      if (path.startsWith('/api/officer/queue')) {
        expect(data.items.length).toBeGreaterThan(0);
        for (const item of data.items) expect(item.idMasked).toMatch(masked);
      } else if (/\/api\/cases\/[^/]+$/.test(path)) expect(data.idMasked).toMatch(masked);
    }
  }
});

test('TC-PDPA-03 · แสดงเลขเต็มต้องมีเหตุผลและ Audit', async ({ app }) => {
  const reg2 = await app.staff('off.reg2');
  await openCase(reg2, 25);
  await reg2.page.getByTestId('show-full-id-btn').click();
  for (const reason of ['', '     ']) {
    await reg2.page.getByTestId('unmask-reason').fill(reason);
    await reg2.page.getByTestId('unmask-submit').click();
    await text(reg2.page, 'unmask-error', 'กรุณากรอกเหตุผล');
    await buttons(reg2.page, { 'full-id': 0 });
    await error(await reg2.api.post(`/api/officer/cases/${caseNo(25)}/unmask`, { data: { reason } }), 400, 'REASON_REQUIRED');
  }
  await reg2.page.getByTestId('unmask-reason').fill('ตรวจสอบตัวตนซ้ำ');
  await reg2.page.getByTestId('unmask-submit').click();
  await text(reg2.page, 'full-id', '3-1006-00987-65-9');
  await reg2.page.reload();
  await text(reg2.page, 'applicant-id', 'X-XXXX-XXXXX-65-9');
  await buttons(reg2.page, { 'full-id': 0 });
  const audit = await app.staff('audit1');
  await auditFilter(audit, { event: 'UNMASK' });
  await text(audit.page, 'audit-count', 1);
  const entry = row(audit.page, 'audit-row', 25);
  await expect(entry).toHaveAttribute('data-actor', 'off.reg2');
  for (const [id, value] of Object.entries({ 'audit-role': 'officer', 'audit-case-no': caseNo(25), 'audit-event': 'UNMASK' })) {
    await expect(entry.getByTestId(id)).toHaveText(value);
  }
  await expect(entry.getByTestId('audit-detail')).toContainText('ตรวจสอบตัวตนซ้ำ');
  await expect(entry.getByTestId('audit-time')).toHaveAttribute('data-iso', NOW);
  for (const s of [await app.staff('exec1'), audit, await app.citizen(SOMYING)]) {
    await error(await s.api.post(`/api/officer/cases/${caseNo(25)}/unmask`, { data: { reason: 'x' } }), 403, 'FORBIDDEN');
  }
});

test('TC-DASH-01 · Dashboard ตัวเลขเริ่มต้น', async ({ app }) => {
  const exec = await app.staff('exec1');
  await exec.page.goto('/dashboard');
  await expect(exec.page.getByTestId('period-select')).toHaveValue('2026-12');
  await expect(exec.page.getByTestId('service-select')).toHaveValue('ALL');
  const data = await dashboard(exec, '2026-12', 'ALL', 3, 0, '–', 21, 1);
  expect(data.workload).toEqual(expect.arrayContaining([
    { username: 'off.reg1', count: 3 }, { username: 'off.reg2', count: 9 }, { username: 'off.works1', count: 0 },
  ]));
  expect(data.workload).toHaveLength(3);
  await expect(exec.page.getByTestId('workload-row')).toHaveCount(3);
  for (const [user, count] of [['off.reg1', 3], ['off.reg2', 9], ['off.works1', 0]] as const) {
    await expect(exec.page.locator(`[data-testid="workload-row"][data-username="${user}"]`).getByTestId('workload-value')).toHaveText(String(count));
  }
  noPersonalData(await exec.page.locator('body').innerText());
  await dashboard(exec, '2026-12', 'SV-01', 3, 0, '–', 11, 1);
  await dashboard(exec, '2026-12', 'SV-02', 0, 0, '–', 7, 0);
  await dashboard(exec, '2026-12', 'SV-03', 0, 0, '–', 3, 0);
});

test('TC-DASH-02 · Dashboard ย้อนหลัง พ.ย. ต.ค. รายปี', async ({ app }) => {
  const exec = await app.staff('exec1');
  const cases: [string, string, number, number, string, number, number][] = [
    ['2026-10', 'ALL', 1, 1, '100.0%', 21, 1],
    ['2026-11', 'ALL', 26, 7, '85.7%', 21, 1],
    ['2026-11', 'SV-01', 12, 3, '100.0%', 11, 1],
    ['2026-11', 'SV-02', 10, 3, '66.7%', 7, 0],
    ['2026-11', 'SV-03', 4, 1, '100.0%', 3, 0],
    ['2026', 'ALL', 30, 8, '87.5%', 21, 1],
    ['2026', 'SV-01', 16, 4, '100.0%', 11, 1],
    ['2026', 'SV-02', 10, 3, '66.7%', 7, 0],
    ['2026', 'SV-03', 4, 1, '100.0%', 3, 0],
  ];
  for (const args of cases) await dashboard(exec, ...args);
});

async function pdfText(bytes: Buffer): Promise<string> {
  // pdf-parse v1 and v2 expose different entry points; either returns extracted text.
  const module: any = await import('pdf-parse');
  if (typeof module.default === 'function') return (await module.default(bytes)).text;
  const parser = new module.PDFParse({ data: new Uint8Array(bytes) });
  try { return (await parser.getText()).text; } finally { await parser.destroy(); }
}
async function xlsxValues(bytes: Buffer, expected: string[]) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as any);
  const sheet = workbook.worksheets[0];
  expect(sheet).toBeTruthy();
  expect([sheet.getCell('A1').text, sheet.getCell('B1').text]).toEqual(['ตัวชี้วัด', 'ค่า']);
  const labels = ['รับเรื่อง', 'ปิดงาน', 'ทันกำหนด %', 'งานคงค้าง', 'เกินกำหนดคงค้าง'];
  for (let i = 0; i < labels.length; i++) {
    expect(sheet.getCell(`A${i + 2}`).text).toBe(labels[i]);
    expect(sheet.getCell(`B${i + 2}`).value).toBe(expected[i]);
  }
  const contents: string[] = [];
  for (const ws of workbook.worksheets) ws.eachRow(r => r.eachCell(c => contents.push(c.text)));
  noPersonalData(contents.join('\n'));
}

test('TC-DASH-03 · ส่งออก Excel/PDF เท่าหน้าจอ และไม่มีข้อมูลส่วนบุคคล', async ({ app }) => {
  const exec = await app.staff('exec1');
  await dashboard(exec, '2026-11', 'ALL', 26, 7, '85.7%', 21, 1);
  const november = await download(exec.page, 'export-xlsx-btn');
  expect(november.download.suggestedFilename()).toMatch(/\.xlsx$/);
  await xlsxValues(november.bytes, ['26', '7', '85.7%', '21', '1']);
  const pdfResponse = exec.page.waitForResponse(r => r.url().includes('/api/dashboard/export') && r.url().includes('format=pdf'));
  const pdf = await download(exec.page, 'export-pdf-btn');
  expect(pdf.download.suggestedFilename()).toMatch(/\.pdf$/);
  expect((await pdfResponse).headers()['content-type']).toContain('application/pdf');
  const extracted = await pdfText(pdf.bytes);
  expect(extracted).toContain('kpi received=26 closed=7 ontime=85.7% backlog=21 overdue=1');
  noPersonalData(extracted);
  await dashboard(exec, '2026-12', 'ALL', 3, 0, '–', 21, 1);
  await xlsxValues((await download(exec.page, 'export-xlsx-btn')).bytes, ['3', '0', '–', '21', '1']);
  const audit = await app.staff('audit1');
  await auditFilter(audit, { event: 'EXPORT' });
  await text(audit.page, 'audit-count', 3);
  const expectedDetails = ['xlsx 2026-11 ALL', 'pdf 2026-11 ALL', 'xlsx 2026-12 ALL'];
  const details: string[] = [];
  for (const entry of await audit.page.getByTestId('audit-row').all()) {
    await expect(entry).toHaveAttribute('data-actor', 'exec1');
    await expect(entry.getByTestId('audit-role')).toHaveText('executive');
    details.push((await entry.getByTestId('audit-detail').innerText()).trim());
  }
  for (const expected of expectedDetails) expect(details.some(d => d.includes(expected))).toBe(true);
});

test('TC-DASH-04 · ค่าขอบทันกำหนด 16:29:59 / 16:30:00 / 16:30:01', async ({ app }) => {
  await app.clock('2026-12-03T16:00:00+07:00');
  const reg1 = await app.staff('off.reg1');
  const reg2 = await app.staff('off.reg2');
  const exec = await app.staff('exec1');
  await caseAction(reg2, 25, 'approve');
  await caseAction(reg1, 23, 'approve');
  const cases: [string, Session, number, string, number, number][] = [
    ['2026-12-03T16:29:59+07:00', reg2, 25, 'issue', 1, 1],
    ['2026-12-03T16:30:00+07:00', reg2, 26, 'reject', 2, 2],
    ['2026-12-03T16:30:01+07:00', reg1, 23, 'issue', 3, 2],
  ];
  for (const [now, s, n, action, closed, onTime] of cases) {
    await app.clock(now);
    await caseAction(s, n, action, action === 'reject' ? { reason: 'xxxxxxxxxx' } : undefined);
    await openCase(s, n);
    await expect(s.page.getByTestId('closed-at')).toHaveAttribute('data-iso', now);
    expect((await get(s, `/api/cases/${caseNo(n)}`)).closedAt).toBe(now);
    expect(await get(exec, dashboardPath)).toMatchObject({ closed, onTime });
    await exec.page.goto('/dashboard');
    await text(exec.page, 'kpi-closed', closed);
  }
  await text(exec.page, 'kpi-backlog', 18);
  expect((await get(exec, dashboardPath)).backlog).toBe(18);
});

test('TC-AUDIT-01 · เหตุการณ์และฟิลด์ใน Audit', async ({ app }) => {
  const reg2 = await app.staff('off.reg2');
  await caseAction(reg2, 28, 'claim');
  const reg1 = await app.staff('off.reg1');
  await caseAction(reg1, 20, 'return', { reason: 'xxxxxxxxxx' });
  await caseAction(reg2, 13, 'forward');
  const head = await app.staff('head1');
  await caseAction(head, 13, 'approve');
  await caseAction(reg2, 25, 'approve');
  await caseAction(reg2, 25, 'issue');
  await caseAction(reg2, 26, 'reject', { reason: 'xxxxxxxxxx' });
  await caseAction(reg2, 25, 'unmask', { reason: 'ตรวจสอบตัวตนซ้ำ' });
  const exec = await app.staff('exec1');
  expect((await exec.api.get('/api/dashboard/export?format=xlsx&period=2026-12&service=ALL')).status()).toBe(200);
  const admin = await app.staff('admin1');
  await put(admin, '/api/admin/services/SV-01', { fee: 25, sla: 3 });
  const audit = await app.staff('audit1');
  await audit.page.goto('/audit');
  await text(audit.page, 'audit-count', 16);
  const all = await get(audit, '/api/audit');
  expect(all.count).toBe(16);
  expect(all.items).toHaveLength(16);
  const counts: Record<string, number> = {
    STAFF_LOGIN: 6, CLAIM: 1, RETURN: 1, FORWARD: 1, APPROVE: 2, ISSUE: 1,
    REJECT: 1, UNMASK: 1, EXPORT: 1, ADMIN_CHANGE: 1,
  };
  for (const [event, count] of Object.entries(counts)) {
    await expect(audit.page.locator(`[data-testid="audit-row"][data-event="${event}"]`)).toHaveCount(count);
    expect(all.items.filter((x: any) => x.event === event)).toHaveLength(count);
  }
  const expected: [string, string, string, number | null, string, string][] = [
    ['CLAIM', 'off.reg2', 'officer', 28, 'SUBMITTED → IN_REVIEW', ''],
    ['RETURN', 'off.reg1', 'officer', 20, 'IN_REVIEW → NEED_FIX', 'xxxxxxxxxx'],
    ['FORWARD', 'off.reg2', 'officer', 13, 'IN_REVIEW → PENDING_APPROVAL', ''],
    ['APPROVE', 'head1', 'head', 13, 'PENDING_APPROVAL → APPROVED', ''],
    ['APPROVE', 'off.reg2', 'officer', 25, 'IN_REVIEW → APPROVED', ''],
    ['ISSUE', 'off.reg2', 'officer', 25, 'APPROVED → COMPLETED', 'DOC-2569-000002'],
    ['REJECT', 'off.reg2', 'officer', 26, 'IN_REVIEW → REJECTED', 'xxxxxxxxxx'],
    ['UNMASK', 'off.reg2', 'officer', 25, '–', 'ตรวจสอบตัวตนซ้ำ'],
    ['EXPORT', 'exec1', 'executive', null, '–', 'xlsx 2026-12'],
    ['ADMIN_CHANGE', 'admin1', 'admin', null, '–', 'SV-01 fee 20 → 25'],
  ];
  for (const [event, actor, role, n, transition, detail] of expected) {
    let entry = audit.page.locator(`[data-testid="audit-row"][data-event="${event}"][data-actor="${actor}"]`);
    if (n !== null) entry = entry.and(row(audit.page, 'audit-row', n));
    await expect(entry).toHaveCount(1);
    await expect(entry.getByTestId('audit-actor')).toHaveText(actor);
    await expect(entry.getByTestId('audit-role')).toHaveText(role);
    await expect(entry.getByTestId('audit-event')).toHaveText(event);
    await expect(entry.getByTestId('audit-transition')).toHaveText(transition);
    if (n !== null) await expect(entry.getByTestId('audit-case-no')).toHaveText(caseNo(n));
    if (detail) await expect(entry.getByTestId('audit-detail')).toContainText(detail);
  }
  const loginActors = all.items.filter((x: any) => x.event === 'STAFF_LOGIN').map((x: any) => x.username).sort();
  expect(loginActors).toEqual(['off.reg2', 'off.reg1', 'head1', 'exec1', 'admin1', 'audit1'].sort());
  const roles: Record<string, string> = { 'off.reg2': 'officer', 'off.reg1': 'officer', head1: 'head', exec1: 'executive', admin1: 'admin', audit1: 'auditor' };
  for (const entry of await audit.page.getByTestId('audit-row').all()) {
    await expect(entry.getByTestId('audit-time')).toHaveAttribute('data-iso', NOW);
    await expect(entry.getByTestId('audit-role')).toHaveText(roles[(await entry.getByTestId('audit-actor').innerText()).trim()]);
  }
  for (const item of all.items) expect(item.time).toBe(NOW);
  const ids = await audit.page.getByTestId('audit-row').evaluateAll(els => els.map(el => Number(el.getAttribute('data-id'))));
  expect(ids).toEqual([...ids].sort((a, b) => b - a));
  expect(all.items.map((x: any) => Number(x.id))).toEqual(ids);
  await auditFilter(audit, { actor: 'off.reg2' });
  await text(audit.page, 'audit-count', 7);
  await auditFilter(audit, { event: 'APPROVE' });
  await text(audit.page, 'audit-count', 2);
  await auditFilter(audit, { actor: 'off.reg2', event: 'APPROVE' });
  await text(audit.page, 'audit-count', 1);
  await auditFilter(audit);
  const csv = await download(audit.page, 'audit-export-csv-btn');
  const lines = csv.bytes.toString('utf8').trimEnd().split(/\r?\n/);
  expect(lines[0]).toBe('time,username,role,event,caseNo,fromStatus,toStatus,detail');
  expect(lines.slice(1)).toHaveLength(16);
  expect(csv.download.suggestedFilename()).toMatch(/\.csv$/);
  await audit.page.reload();
  await text(audit.page, 'audit-count', 17);
  const exported = await get(audit, '/api/audit?actor=audit1&event=EXPORT');
  expect(exported.count).toBe(1);
  expect(exported.items[0].detail).toContain('audit-csv');
});

test('TC-AUDIT-02 · Audit แก้/ลบไม่ได้ (405)', async ({ app }) => {
  const audit = await app.staff('audit1');
  const before = (await get(audit, '/api/audit')).items;
  expect(before).toHaveLength(1);
  expect(before[0].event).toBe('STAFF_LOGIN');
  const admin = await app.staff('admin1');
  for (const s of [admin, audit]) {
    for (const [method, path] of [
      ['PUT', `/api/audit/${before[0].id}`], ['PATCH', `/api/audit/${before[0].id}`],
      ['DELETE', `/api/audit/${before[0].id}`], ['PUT', '/api/audit'],
      ['DELETE', '/api/audit'], ['DELETE', '/api/audit/999999'],
    ]) await error(await s.api.fetch(path, { method, ...(method === 'PUT' ? { data: { detail: 'x' } } : {}) }), 405, 'METHOD_NOT_ALLOWED');
  }
  const after = (await get(audit, '/api/audit')).items;
  expect(after).toHaveLength(2);
  expect(after).toEqual(expect.arrayContaining(before));
  const added = after.filter((x: any) => !before.some((b: any) => b.id === x.id));
  expect(added).toHaveLength(1);
  expect(added[0]).toMatchObject({ event: 'STAFF_LOGIN', username: 'admin1' });
  await audit.page.goto('/audit');
  await buttons(audit.page, { 'audit-edit-btn': 0, 'audit-delete-btn': 0 });
  await error(await admin.api.get('/api/audit'), 403, 'FORBIDDEN');
});

test('TC-AUDIT-03 · กรองช่วงวันที่ตามเวลาไทย', async ({ app }) => {
  const logins: [string, string][] = [
    ['2026-11-30T23:59:59+07:00', 'off.reg1'], ['2026-12-01T00:00:00+07:00', 'off.reg2'],
    ['2026-12-01T23:59:59+07:00', 'off.works1'], ['2026-12-02T00:00:00+07:00', 'off.reg1'],
    ['2026-12-02T09:00:00+07:00', 'audit1'],
  ];
  for (const [now, user] of logins) { await app.clock(now); await app.staff(user, true); }
  const audit = await app.staff('audit1');
  const filters: [string, string, number[], string?][] = [
    ['2026-12-01', '2026-12-01', [1, 2]], ['2026-11-30', '2026-11-30', [0]],
    ['2026-11-30', '2026-12-01', [0, 1, 2]], ['2026-12-02', '', [3, 4]],
    ['', '2026-11-30', [0]], ['2026-12-01', '2026-12-02', [1, 2, 3, 4]],
    ['2026-12-01', '2026-12-01', [1], 'off.reg2'],
  ];
  for (const [from, to, indexes, actor = ''] of filters) {
    await auditFilter(audit, { from, to, actor });
    await text(audit.page, 'audit-count', indexes.length);
    const data = await get(audit, `/api/audit?${new URLSearchParams({ from, to, actor })}`);
    expect(data.count).toBe(indexes.length);
    const expected = indexes.map(i => `${logins[i][0]}|${logins[i][1]}`).sort();
    expect(data.items.map((x: any) => `${x.time}|${x.username}`).sort()).toEqual(expected);
    const actual: string[] = [];
    for (const entry of await audit.page.getByTestId('audit-row').all()) {
      actual.push(`${await entry.getByTestId('audit-time').getAttribute('data-iso')}|${(await entry.getByTestId('audit-actor').innerText()).trim()}`);
    }
    expect(actual.sort()).toEqual(expected);
  }
});

test('TC-RBAC-01 · ประชาชนเปิดคำขอคนอื่นไม่ได้ (IDOR)', async ({ app }) => {
  const woman = await app.citizen(SOMYING);
  expect((await woman.page.goto(`/citizen/cases/${caseNo(5)}`))?.status()).toBe(404);
  await text(woman.page, 'not-found-msg', 'ไม่พบคำขอ');
  await buttons(woman.page, { 'case-no': 0, 'case-status': 0 });
  expect(await woman.page.content()).not.toContain('สมชาย');
  const other = await woman.api.get(`/api/cases/${caseNo(5)}`);
  const absent = await woman.api.get('/api/cases/EG-2569-999999');
  expect(await json(other, 404)).toEqual({ code: 'NOT_FOUND', message: 'ไม่พบคำขอ' });
  expect(await json(absent, 404)).toEqual({ code: 'NOT_FOUND', message: 'ไม่พบคำขอ' });
  expect(await other.text()).toBe(await absent.text());
  expect((await woman.api.get('/api/documents/DOC-2569-000001/pdf')).status()).toBe(404);
  expect((await woman.api.get('/api/drafts/DR-0001')).status()).toBe(404);
  expect((await woman.api.post(`/api/cases/${caseNo(30)}/cancel`)).status()).toBe(404);
  await openCase(woman, 7, true);
  await get(await app.citizen(), `/api/cases/${caseNo(5)}`);
});

test('TC-RBAC-02 · เจ้าหน้าที่อนุมัติ SV-02 ไม่ได้ (API)', async ({ app }) => {
  const reg2 = await app.staff('off.reg2');
  for (const [n, status] of [[14, 'PENDING_APPROVAL'], [13, 'IN_REVIEW']] as const) {
    await error(await reg2.api.post(`/api/cases/${caseNo(n)}/approve`), 403, 'FORBIDDEN');
    expect((await get(reg2, `/api/cases/${caseNo(n)}`)).status).toBe(status);
    await openCase(reg2, n);
    await buttons(reg2.page, { 'approve-btn': 0 });
  }
  await error(await reg2.api.post(`/api/cases/${caseNo(14)}/reject`, { data: { reason: 'xxxxxxxxxx' } }), 403, 'FORBIDDEN');
  expect((await get(reg2, `/api/cases/${caseNo(14)}`)).status).toBe('PENDING_APPROVAL');
  const head = await app.staff('head1');
  await error(await head.api.post(`/api/cases/${caseNo(25)}/approve`), 403, 'FORBIDDEN');
  expect((await caseAction(head, 14, 'approve')).status).toBe('APPROVED');
  const audit = await app.staff('audit1');
  await auditFilter(audit, { event: 'APPROVE' });
  await text(audit.page, 'audit-count', 1);
  await expect(audit.page.getByTestId('audit-row')).toHaveAttribute('data-actor', 'head1');
});

test('TC-RBAC-03 · ตารางสิทธิ์หน้า/API ตามบทบาท', async ({ app }) => {
  const roles = ['anon', 'citizen', 'officer', 'head', 'executive', 'auditor', 'admin'];
  const accounts: Record<string, string> = { officer: 'off.reg1', head: 'head1', executive: 'exec1', auditor: 'audit1', admin: 'admin1' };
  const nav: Record<string, string[]> = {
    citizen: ['nav-my-cases'], officer: ['nav-queue', 'nav-bell'], head: ['nav-queue', 'nav-approvals', 'nav-bell'],
    executive: ['nav-dashboard'], auditor: ['nav-audit'], admin: ['nav-admin-services', 'nav-admin-holidays', 'nav-admin-users'],
  };
  const routes: [string, string[]][] = [
    ['/citizen', ['citizen']], ['/officer/queue', ['officer', 'head']], ['/head/approvals', ['head']],
    ['/dashboard', ['executive']], ['/audit', ['auditor']], ['/admin/services', ['admin']],
    ['/admin/holidays', ['admin']], ['/admin/users', ['admin']], ['/notifications', ['officer', 'head']],
    ['/verify/K7M2Q9XA', roles],
  ];
  const apis: [string, string, string[], unknown?][] = [
    ['GET', '/api/officer/queue', ['officer', 'head']], ['GET', '/api/notifications', ['officer', 'head']],
    ['GET', dashboardPath, ['executive']], ['GET', '/api/audit', ['auditor']], ['GET', '/api/admin/services', ['admin']],
    ['POST', '/api/drafts', ['citizen'], { serviceId: 'SV-01', qty: 1 }],
    ['GET', `/api/cases/${caseNo(25)}`, ['citizen', 'officer', 'head']],
    ['POST', `/api/officer/cases/${caseNo(28)}/claim`, ['officer']],
  ];
  for (const role of roles) {
    await app.reset();
    const s = role === 'anon' ? await app.session() : role === 'citizen' ? await app.citizen() : await app.staff(accounts[role]);
    if (role !== 'anon') {
      await s.page.goto('/');
      for (const id of [...new Set(Object.values(nav).flat())]) await buttons(s.page, { [id]: nav[role].includes(id) ? 1 : 0 });
    }
    for (const [path, allowed] of routes) {
      const response = await s.page.goto(path);
      if (allowed.includes(role)) expect(response?.status(), `${role} ${path}`).toBe(200);
      else if (role === 'anon') await expect(s.page).toHaveURL(/\/login(?:\?.*)?$/);
      else {
        expect(response?.status(), `${role} ${path}`).toBe(403);
        await text(s.page, 'forbidden-msg', 'ไม่มีสิทธิ์เข้าถึงหน้านี้');
      }
    }
    for (const [method, path, allowed, data] of apis) {
      // The case API matrix explicitly uses Sոմหญิง, while the page matrix uses Sոմชาย.
      const actor = role === 'citizen' && path === `/api/cases/${caseNo(25)}` ? await app.citizen(SOMYING) : s;
      const response = await actor.api.fetch(path, { method, ...(data ? { data } : {}) });
      const expected = role === 'anon' ? 401 : allowed.includes(role) ? (path === '/api/drafts' ? 201 : 200) : 403;
      expect(response.status(), `${role} ${method} ${path}`).toBe(expected);
    }
  }
  await app.reset();
  const works = await app.staff('off.works1');
  const registry = await app.staff('off.reg1');
  await error(await works.api.post(`/api/officer/cases/${caseNo(28)}/claim`), 403, 'FORBIDDEN');
  await error(await registry.api.post(`/api/officer/cases/${caseNo(10)}/claim`), 403, 'FORBIDDEN');
  expect((await get(works, '/api/officer/queue')).items.map((x: any) => x.caseNo)).toEqual([caseNo(10)]);
});

test('TC-RBAC-04 · ผู้ดูแลระบบ: บริการ วันหยุด ผู้ใช้ และยอดที่ล็อก', async ({ app }) => {
  const admin = await app.staff('admin1');
  await admin.page.goto('/admin/holidays');
  await expect(admin.page.getByTestId('holiday-row')).toHaveCount(4);
  expect(await admin.page.getByTestId('holiday-row').evaluateAll(els => els.map(el => el.getAttribute('data-date')).sort()))
    .toEqual(['2026-12-07', '2026-12-10', '2026-12-31', '2027-01-01']);
  const before = await app.newPaid({ now: NOW, qty: 1, fee: 20 });
  expect(before.paid.caseNo).toBe('EG-2569-000031');
  expect((await get(before.s, `/api/cases/${before.paid.caseNo}`)).dueAt).toBe('2026-12-04T16:30:00+07:00');
  await admin.page.goto('/admin/services');
  for (const [service, fee] of [['SV-01', '25'], ['SV-02', '600']]) {
    await admin.page.getByTestId(`svc-fee-${service}`).fill(fee);
    const saved = admin.page.waitForResponse(r => r.url().endsWith(`/api/admin/services/${service}`) && r.request().method() === 'PUT');
    await admin.page.getByTestId(`svc-save-${service}`).click();
    expect((await saved).status()).toBe(200);
    await expect(admin.page.getByTestId('action-success')).toBeVisible();
  }
  const citizen = await app.citizen();
  await citizen.page.goto('/citizen/new/SV-01');
  await citizen.page.getByTestId('qty-input').fill('5');
  await text(citizen.page, 'fee-total', '฿125');
  await citizen.page.getByTestId('qty-input').fill('1');
  await text(citizen.page, 'fee-total', '฿25');
  await citizen.page.goto('/citizen/new/SV-02');
  await text(citizen.page, 'fee-total', '฿600');
  await openCase(citizen, 30, true);
  await text(citizen.page, 'case-fee', '฿20');
  await citizen.page.goto('/citizen/new/SV-02?draft=DR-0002');
  await text(citizen.page, 'payment-amount', '฿500');
  const control = await app.raw();
  await error(await control.post('/api/test/payments/PP-0001/pay', { data: { amount: 600 } }), 422, 'AMOUNT_MISMATCH');
  expect(await json(await control.post('/api/test/payments/PP-0001/pay', { data: { amount: 500 } })))
    .toMatchObject({ status: 'PAID', caseNo: 'EG-2569-000032' });
  await admin.page.goto('/admin/holidays');
  await admin.page.getByTestId('holiday-date-input').fill('2026-12-02');
  await admin.page.getByTestId('holiday-name-input').fill('วันหยุดทดสอบ');
  await admin.page.getByTestId('holiday-add-btn').click();
  await expect(admin.page.getByTestId('holiday-row')).toHaveCount(5);
  expect((await get(citizen, '/api/cases/EG-2569-000031')).dueAt).toBe('2026-12-04T16:30:00+07:00');
  const after = await app.newPaid({ now: NOW, qty: 1, fee: 25 });
  expect(after.paid.caseNo).toBe('EG-2569-000033');
  expect((await get(citizen, '/api/cases/EG-2569-000033')).dueAt).toBe('2026-12-08T16:30:00+07:00');
  await put(admin, '/api/admin/users/exec1', { role: 'auditor', dept: '' });
  const changed = await app.staff('exec1', true);
  await changed.page.goto('/');
  await expect(changed.page).toHaveURL(/\/audit$/);
  expect((await changed.page.goto('/dashboard'))?.status()).toBe(403);
  await auditFilter(changed, { event: 'ADMIN_CHANGE' });
  await text(changed.page, 'audit-count', 4);
  const expectedDetails = ['SV-01 fee 20 → 25', 'SV-02 fee 500 → 600', 'holiday add 2026-12-02', 'exec1 role executive → auditor'];
  const details = await changed.page.getByTestId('audit-detail').allTextContents();
  for (const detail of expectedDetails) expect(details.some(d => d.includes(detail))).toBe(true);
  for (const entry of await changed.page.getByTestId('audit-row').all()) {
    await expect(entry).toHaveAttribute('data-actor', 'admin1');
    await expect(entry.getByTestId('audit-role')).toHaveText('admin');
  }
  await error(await admin.api.post('/api/drafts', { data: { serviceId: 'SV-01', qty: 1 } }), 403, 'FORBIDDEN');
  await admin.page.goto('/admin/holidays');
  await admin.page.locator('[data-testid="holiday-row"][data-date="2026-12-02"]').getByTestId('holiday-delete-btn').click();
  await expect(admin.page.getByTestId('holiday-row')).toHaveCount(4);
  await auditFilter(changed, { event: 'ADMIN_CHANGE' });
  await text(changed.page, 'audit-count', 5);
  await expect(changed.page.getByTestId('audit-detail').filter({ hasText: 'holiday delete 2026-12-02' })).toHaveCount(1);
});

test('TC-RBAC-05 · สิทธิ์เปิด/ดาวน์โหลดไฟล์แนบ', async ({ app }) => {
  const registry = await app.staff('off.reg1');
  const fileMap = new Map<number, { fileId: string; name: string }[]>();
  for (const n of [25, 12, 10, 11]) fileMap.set(n, (await get(registry, `/api/cases/${caseNo(n)}/files`)).items);
  const rows: [string, number, number][] = [
    ['off.reg1', 25, 200], ['off.works1', 25, 403], ['off.reg2', 12, 200], ['off.works1', 12, 403],
    ['off.works1', 10, 200], ['off.reg1', 10, 200], ['off.works1', 11, 200],
    ['head1', 25, 200], ['head1', 10, 200], ['head1', 12, 200],
    [SOMYING, 25, 200], [SOMCHAI, 25, 404], ['exec1', 25, 403], ['audit1', 25, 403], ['admin1', 25, 403], ['anon', 25, 401],
  ];
  for (const [user, n, status] of rows) {
    const s = user === 'anon' ? await app.session() : /^\d/.test(user) ? await app.citizen(user) : await app.staff(user);
    const listed = await s.api.get(`/api/cases/${caseNo(n)}/files`);
    expect(listed.status(), `${user} files ${n}`).toBe(status);
    const known = fileMap.get(n)!;
    if (status === 200) {
      const body = await json(listed);
      expect(body.items.map((x: any) => x.name).sort()).toEqual(n === 25 ? ['id-card.pdf'] : ['deed.pdf', 'id-card.pdf', 'plan.pdf']);
      expect(body.items).toHaveLength(n === 25 ? 1 : 3);
    }
    for (const file of known) {
      const content = await s.api.get(`/api/files/${file.fileId}`);
      expect(content.status(), `${user} file ${file.name}`).toBe(status);
      if (status === 200) {
        expect(content.headers()['content-type']).toContain('application/pdf');
        expect((await content.body()).subarray(0, 4).toString()).toBe('%PDF');
      }
    }
  }
  expect((await registry.api.get('/api/files/nonexistent-file-id')).status()).toBe(404);
  await openCase(registry, 25);
  await expect(registry.page.getByTestId('doc-item')).toHaveCount(1);
  await expect(registry.page.getByTestId('doc-item')).toHaveAttribute('data-name', 'id-card.pdf');
  const attachmentId = fileMap.get(25)![0].fileId;
  const link = registry.page.getByTestId('doc-download-link');
  const attachmentPath = `/api/files/${attachmentId}`;
  const href = await link.getAttribute('href');
  expect(href).toBeTruthy();
  expect(new URL(href!, app.baseURL).pathname).toBe(attachmentPath);
  // Download headers and inline PDF viewing are both valid for attachment links.
  const requested = registry.context.waitForEvent('request', r => new URL(r.url()).pathname === attachmentPath);
  await link.click();
  await requested;
  const attachment = await registry.api.get(attachmentPath);
  expect(attachment.status()).toBe(200);
  expect((await attachment.body()).length).toBeGreaterThan(0);
  const reg2 = await app.staff('off.reg2');
  await openCase(reg2, 12);
  await expect(reg2.page.getByTestId('doc-item')).toHaveCount(3);
  const woman = await app.citizen(SOMYING);
  await openCase(woman, 25, true);
  await expect(woman.page.getByTestId('doc-item')).toHaveCount(1);
});

test('TC-RBAC-06 · ผู้ดูแลระบบ: ช่วงค่าที่ยอมรับ', async ({ app }) => {
  const admin = await app.staff('admin1');
  const feeMsg = 'ค่าธรรมเนียมต้องเป็นจำนวนเต็ม 0–100,000 บาท';
  const slaMsg = 'SLA ต้องเป็นจำนวนเต็ม 1–60 วันทำการ';
  const cases: ['fee' | 'sla', number, number, string?][] = [
    ['fee', -1, 400, 'INVALID_FEE'], ['fee', 0, 200], ['fee', 100000, 200], ['fee', 100001, 400, 'INVALID_FEE'],
    ['sla', 0, 400, 'INVALID_SLA'], ['sla', 1, 200], ['sla', 60, 200], ['sla', 61, 400, 'INVALID_SLA'],
  ];
  for (const [field, value, status, code] of cases) {
    const before = (await get(admin, '/api/admin/services')).items;
    await admin.page.goto('/admin/services');
    await admin.page.getByTestId(`svc-${field}-SV-01`).fill(String(value));
    if (status === 200) {
      // Validate the actual UI PUT rather than sending a second successful write (Audit must total 5).
      const pending = admin.page.waitForResponse(r => r.url().endsWith('/api/admin/services/SV-01') && r.request().method() === 'PUT');
      await admin.page.getByTestId('svc-save-SV-01').click();
      expect((await pending).status()).toBe(200);
      await expect(admin.page.getByTestId('action-success')).toBeVisible();
      expect((await get(admin, '/api/admin/services')).items.find((x: any) => x.id === 'SV-01')[field]).toBe(value);
    } else {
      await admin.page.getByTestId('svc-save-SV-01').click();
      await text(admin.page, 'action-error', field === 'fee' ? feeMsg : slaMsg);
      await error(await admin.api.put('/api/admin/services/SV-01', { data: { [field]: value } }), 400, code, field === 'fee' ? feeMsg : slaMsg);
      expect((await get(admin, '/api/admin/services')).items).toEqual(before);
    }
  }
  await admin.page.goto('/admin/holidays');
  await error(await admin.api.post('/api/admin/holidays', { data: { date: '2026-12-07', name: 'ซ้ำ' } }), 409, 'DUPLICATE_HOLIDAY', 'มีวันหยุดนี้อยู่แล้ว');
  await expect(admin.page.getByTestId('holiday-row')).toHaveCount(4);
  await post(admin, '/api/admin/holidays', { date: '2026-12-05', name: 'วันเสาร์' }, 201);
  await error(await admin.api.put('/api/admin/users/admin1', { data: { role: 'executive', dept: '' } }),
    409, 'SELF_ROLE_CHANGE', 'ไม่สามารถเปลี่ยนบทบาทของตัวเองได้');
  expect((await get(admin, '/api/me')).role).toBe('admin');
  const audit = await app.staff('audit1');
  await auditFilter(audit, { event: 'ADMIN_CHANGE' });
  await text(audit.page, 'audit-count', 5);
  expect((await get(audit, '/api/audit?event=ADMIN_CHANGE')).items).toHaveLength(5);
});

const responsivePages: [string, string][] = [
  ['anon', '/login'], [SOMCHAI, '/citizen'], [SOMCHAI, '/citizen/new/SV-03'],
  [SOMCHAI, `/citizen/cases/${caseNo(13)}`], ['off.reg1', '/officer/queue'],
  ['off.reg1', `/officer/cases/${caseNo(20)}`], ['head1', '/head/approvals'],
  ['exec1', '/dashboard'], ['audit1', '/audit'], ['admin1', '/admin/services'], ['anon', '/verify/K7M2Q9XA'],
];
async function identity(app: App, user: string) {
  return user === 'anon' ? app.session() : /^\d/.test(user) ? app.citizen(user) : app.staff(user);
}

test('TC-NFR-01 · Responsive 375/768/1280', async ({ app }) => {
  let checked = 0;
  for (const [width, height] of [[375, 812], [768, 1024], [1280, 800]]) {
    for (const [user, path] of responsivePages) {
      const s = await identity(app, user);
      await s.page.setViewportSize({ width, height });
      expect((await s.page.goto(path))?.status()).toBe(200);
      const dimensions = await s.page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
      expect(dimensions.innerWidth).toBe(width);
      expect(dimensions.scrollWidth, `${path} at ${width}px`).toBeLessThanOrEqual(dimensions.innerWidth);
      checked++;
    }
  }
  expect(checked).toBe(33);
  const mobile = await app.session('mobile-ui');
  await mobile.page.setViewportSize({ width: 375, height: 812 });
  await keyboardJourney(mobile.page);
  const box = await mobile.page.getByTestId('create-qr-btn').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
});

test('TC-NFR-02 · WCAG axe คีย์บอร์ด label และข้อความสถานะ', async ({ app }) => {
  const pages: [string, string][] = [
    ['anon', '/login'], [MANA, '/register'], [SOMCHAI, '/citizen'], [SOMCHAI, '/citizen/new/SV-01'],
    [SOMCHAI, `/citizen/cases/${caseNo(17)}`], ['off.reg1', '/officer/queue'],
    ['off.reg1', `/officer/cases/${caseNo(20)}`], ['head1', '/head/approvals'], ['exec1', '/dashboard'],
    ['audit1', '/audit'], ['admin1', '/admin/services'], ['off.reg1', '/notifications'], ['anon', '/verify/K7M2Q9XA'],
  ];
  for (const [user, path] of pages) {
    const s = await identity(app, user);
    expect((await s.page.goto(path))?.status()).toBe(200);
    const scan = await new AxeBuilder({ page: s.page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const severe = scan.violations.filter(v => ['serious', 'critical'].includes(v.impact ?? ''));
    expect(severe, `${path}: ${JSON.stringify(severe.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })))}`).toEqual([]);
    const unnamed = await s.page.locator('input:visible, select:visible, textarea:visible').evaluateAll(els =>
      els.filter(el => {
        const input = el as HTMLInputElement;
        const labelledBy = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/)
          .map(id => document.getElementById(id)?.textContent?.trim() ?? '').join('').trim();
        const label = [...(input.labels ?? [])].map(l => l.textContent?.trim() ?? '').join('').trim();
        const aria = el.getAttribute('aria-label')?.trim();
        const nativeButtonName = input.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes(input.type) && input.value.trim();
        return !aria && !labelledBy && !label && !nativeButtonName;
      }).map(el => el.getAttribute('data-testid') ?? el.outerHTML));
    expect(unnamed, `Visible form controls need accessible names: ${path}`).toEqual([]);
    await checkStatusLabels(s.page);
  }
  // A fresh unauthenticated context makes this an actual login journey.
  const keyboard = await app.session('keyboard-only');
  await keyboardJourney(keyboard.page);
});

test('TC-NFR-03 · Health เวลาโหลด และผลซ้ำได้', async ({ app }) => {
  const anon = await app.session();
  expect(await get(anon, '/api/health')).toEqual({ status: 'ok' });
  const timings: Record<string, number> = {};
  for (const [user, path] of [
    ['anon', '/login'], [SOMCHAI, '/citizen'], ['off.reg1', '/officer/queue'], ['exec1', '/dashboard'], ['audit1', '/audit'],
  ]) {
    const s = await identity(app, user);
    expect((await s.page.goto(path, { waitUntil: 'load' }))?.status()).toBe(200);
    const start = performance.now();
    const response = await s.page.goto(path, { waitUntil: 'load' });
    const elapsed = performance.now() - start;
    expect(response?.status()).toBe(200);
    timings[path] = elapsed;
    expect(elapsed, `Warm load of ${path}`).toBeLessThanOrEqual(3000);
  }
  await app.info.attach('warm-load-ms', { body: JSON.stringify(timings, null, 2), contentType: 'application/json' });
  const snapshot = async () => {
    const reg = await app.staff('off.reg1');
    const exec = await app.staff('exec1');
    const queue = await get(reg, '/api/officer/queue');
    return {
      clock: await json(await (await app.raw()).get('/api/test/clock')),
      queue: queue.items.map(({ caseNo, dueAt, status, owner }: any) => ({ caseNo, dueAt, status, owner })),
      dashboard: await get(exec, dashboardPath),
    };
  };
  await app.reset();
  const s1 = await snapshot();
  expect(s1.clock).toEqual({ now: NOW });
  await app.clock('2026-12-10T12:00:00+07:00');
  await caseAction(await app.staff('off.reg1'), 28, 'claim');
  await app.newPaid();
  await app.reset();
  const s2 = await snapshot();
  expect(s2).toEqual(s1);
  await error(await (await app.raw()).put('/api/test/clock', { data: { now: '2026-12-01 09:00' } }), 400, 'INVALID_TIME');
  // The brief makes the second server optional; set NON_TEST_BASE_URL when available.
  if (process.env.NON_TEST_BASE_URL) {
    const response = await (await app.raw()).post(new URL('/api/test/reset', process.env.NON_TEST_BASE_URL).toString());
    expect(response.status()).toBe(404);
  }
});

test('TC-NFR-04 · เข้ารหัสข้อมูลส่วนบุคคลที่เก็บ (inspection)', async ({ app }) => {
  const mana = await app.citizen(MANA);
  expect((await mana.api.post('/api/auth/register', { data: { mobile: '0845678901', email: '', consent: true } })).status()).toBe(201);
  // DB_PATH is mandatory evidence. Do not turn missing storage access into a passing test.
  expect(process.env.DB_PATH, 'Set DB_PATH to the running application database for NFR-04').toBeTruthy();
  const extraPaths = [process.env.DB_DUMP_PATH, process.env.APP_LOG_PATH].filter((p): p is string => !!p);
  const files = await inspectStorage(process.env.DB_PATH!, extraPaths);
  expect(files.length).toBeGreaterThan(0);
  const owner = await app.citizen();
  expect((await get(owner, `/api/cases/${caseNo(5)}`)).idNo).toBe(SOMCHAI);
  await app.info.attach('encryption-inspection', {
    body: JSON.stringify({ files, plaintextMatches: 0, positiveControl: 'Citizen API decrypts the original idNo correctly',
      encryptionMethod: process.env.ENCRYPTION_METHOD ?? 'Not provided; record the application encryption method in the test report',
      logAndDumpInspection: extraPaths.length ? extraPaths : 'No external dump/log paths supplied; database and sidecars inspected' }, null, 2),
    contentType: 'application/json',
  });
});
