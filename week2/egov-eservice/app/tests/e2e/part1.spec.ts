// Black-box contract tests: expected values are copied from TEST-PLAN §§2–8.
import {
  test, expect, CITIZENS, INITIAL_NOW, caseNo, row, json, error,
  createDraft, upload, readyPayment, pay, newPaid, openUpload, uiUpload,
  removeFile, getCase, claim, assertClaimAudit, assertLevel, testFile,
} from './helpers1';

// Keep ordinary tests independent while allowing the runner to continue after a failure.
test.describe.configure({ mode: 'default' });

test('TC-AUTH-01 เลขบัตร 13 หลัก + checksum', async ({ h }) => {
  const { page, api } = await h.anonymous();
  for (const idNo of ['110170012345', '11017001234567', '1101700123457', '11017001234ab']) {
    await page.goto('/login');
    await page.getByTestId('login-tab-citizen').click();
    await page.getByTestId('thaid-id-input').fill(idNo);
    await expect(page.getByTestId('thaid-id-input')).toHaveValue(idNo);
    await page.getByTestId('thaid-submit').click();
    await expect(page.getByTestId('thaid-error')).toHaveText('เลขบัตรประชาชนไม่ถูกต้อง');
    await expect(page.getByTestId('otp-step')).not.toBeVisible();
    await error(await api.post('/api/auth/thaid/start', { data: { idNo } }), 400, 'INVALID_ID');
  }
  for (const idNo of ['1101700123456', '3100600987659', '1909900555015', '5500400111221']) {
    await page.goto('/login');
    await page.getByTestId('thaid-id-input').fill(idNo);
    await page.getByTestId('thaid-submit').click();
    await expect(page.getByTestId('otp-step')).toBeVisible();
    await expect(page.getByTestId('thaid-error')).not.toBeVisible();
    expect(await json(await api.post('/api/auth/thaid/start', { data: { idNo } }))).toEqual({ status: 'OTP_SENT' });
  }
});

test('TC-AUTH-02 OTP ผิด 3 ครั้งล็อก 15 นาที', async ({ h }) => {
  let s = await h.anonymous();
  const idNo = CITIZENS.piti;
  await s.page.goto('/login');
  await s.page.getByTestId('thaid-id-input').fill(idNo);
  await s.page.getByTestId('thaid-submit').click();
  const attempt = async (otp: string, status: number, code?: string) => {
    const response = s.page.waitForResponse(r => r.url().endsWith('/api/auth/thaid/verify'));
    await s.page.getByTestId('otp-input').fill(otp);
    await s.page.getByTestId('otp-submit').click();
    const result = await json(await response, status);
    if (code) expect(result.code).toBe(code);
    return result;
  };
  for (const remaining of [2, 1]) {
    const body = await attempt('000000', 401, 'OTP_INVALID');
    expect(body.attemptsLeft).toBe(remaining);
    await expect(s.page.getByTestId('otp-error')).toHaveText('รหัส OTP ไม่ถูกต้อง');
    await expect(s.page.getByTestId('otp-attempts-left')).toHaveText(`เหลือ ${remaining} ครั้ง`);
  }
  expect((await attempt('000000', 423, 'LOCKED')).lockedUntil).toBe('2026-12-01T09:15:00+07:00');
  await expect(s.page.getByTestId('lock-message')).toHaveText('ผิดเกินกำหนด เลขบัตรนี้ถูกล็อก 15 นาที');
  await expect(s.page.getByTestId('lock-until')).toHaveAttribute('data-iso', '2026-12-01T09:15:00+07:00');
  const verify = (otp: string) => s.api.post('/api/auth/thaid/verify', { data: { idNo, otp } });
  await error(await verify('123456'), 423, 'LOCKED');
  const somchai = await h.citizen();
  expect((await json(await somchai.api.get('/api/me'))).role).toBe('citizen');
  await h.clock('2026-12-01T09:14:59+07:00');
  await error(await verify('123456'), 423, 'LOCKED');
  await h.clock('2026-12-01T09:15:00+07:00');
  expect((await attempt('000000', 401, 'OTP_INVALID')).attemptsLeft).toBe(2);
  await expect(s.page.getByTestId('otp-attempts-left')).toHaveText('เหลือ 2 ครั้ง');
  await attempt('123456', 200);
  await expect(s.page).toHaveURL(/\/citizen$/);

  await h.reset(); s = await h.anonymous();
  await json(await s.api.post('/api/auth/thaid/start', { data: { idNo } }));
  for (const left of [2, 1]) expect((await error(await verify('000000'), 401, 'OTP_INVALID')).attemptsLeft).toBe(left);
  await json(await verify('123456'));
  expect((await s.api.post('/api/auth/logout')).status()).toBe(204);
  await json(await s.api.post('/api/auth/thaid/start', { data: { idNo } }));
  for (const left of [2, 1]) expect((await error(await verify('000000'), 401, 'OTP_INVALID')).attemptsLeft).toBe(left);
});

test('TC-AUTH-03 ลงทะเบียนครั้งแรก', async ({ h }) => {
  const s = await h.anonymous(); const { page } = s;
  const login = async () => {
    await page.goto('/login');
    await page.getByTestId('thaid-id-input').fill(CITIZENS.mana);
    await page.getByTestId('thaid-submit').click();
    await page.getByTestId('otp-input').fill('123456');
    await page.getByTestId('otp-submit').click();
  };
  await login(); await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByTestId('reg-name')).toHaveValue('มานะ ตั้งใจ');
  expect(await page.getByTestId('reg-name').evaluate((el: HTMLInputElement) => el.readOnly)).toBe(true);
  await page.getByTestId('reg-name').focus(); await page.keyboard.type('แก้ไข');
  await expect(page.getByTestId('reg-name')).toHaveValue('มานะ ตั้งใจ');
  await page.getByTestId('reg-consent').check();
  for (const mobile of ['081234567', '08123456789', '1812345678', '08123abcde']) {
    await page.getByTestId('reg-mobile').fill(mobile);
    await page.getByTestId('reg-submit').click();
    await expect(page.getByTestId('reg-error-mobile')).toHaveText('เบอร์มือถือต้องเป็นตัวเลข 10 หลักขึ้นต้นด้วย 0');
    await expect(page).toHaveURL(/\/register$/);
  }
  await page.getByTestId('reg-mobile').fill('0845678901');
  await page.getByTestId('reg-consent').uncheck();
  await page.getByTestId('reg-submit').click();
  await expect(page.getByTestId('reg-error-consent')).toHaveText('กรุณายินยอมการประมวลผลข้อมูลส่วนบุคคล (PDPA)');
  await expect(page).toHaveURL(/\/register$/);
  await page.getByTestId('reg-email').fill('');
  await page.getByTestId('reg-consent').check(); await page.getByTestId('reg-submit').click();
  await expect(page).toHaveURL(/\/citizen$/);
  await expect(page.getByTestId('citizen-welcome')).toHaveText('สวัสดี มานะ ตั้งใจ');
  await page.getByTestId('logout-btn').click(); await login();
  await expect(page).toHaveURL(/\/citizen$/);
  await h.reset();
  const fresh = await h.citizen(CITIZENS.mana);
  await error(await fresh.api.post('/api/auth/register', { data: { mobile: '081234567', email: '', consent: true } }), 400, 'INVALID_MOBILE');
  await error(await fresh.api.post('/api/auth/register', { data: { mobile: '0845678901', email: '', consent: false } }), 400, 'CONSENT_REQUIRED');
});

test('TC-AUTH-04 เจ้าหน้าที่ SSO จำลองและหน้าตั้งต้นตามบทบาท', async ({ h }) => {
  const staff = [
    ['off.reg1', '/officer/queue', 'เจ้าหน้าที่ทะเบียน 1', 'เจ้าหน้าที่', 'officer', 'registry'],
    ['off.reg2', '/officer/queue', 'เจ้าหน้าที่ทะเบียน 2', 'เจ้าหน้าที่', 'officer', 'registry'],
    ['off.works1', '/officer/queue', 'เจ้าหน้าที่โยธา 1', 'เจ้าหน้าที่', 'officer', 'works'],
    ['head1', '/head/approvals', 'หัวหน้าฝ่าย', 'หัวหน้าฝ่าย', 'head'],
    ['exec1', '/dashboard', 'ผู้บริหาร', 'ผู้บริหาร', 'executive'],
    ['audit1', '/audit', 'ผู้ตรวจสอบภายใน', 'ผู้ตรวจสอบภายใน', 'auditor'],
    ['admin1', '/admin/services', 'ผู้ดูแลระบบ', 'ผู้ดูแลระบบ', 'admin'],
  ];
  for (const [username, landing, name, roleText, role, dept] of staff) {
    const { page } = await h.anonymous();
    await page.goto('/login'); await page.getByTestId('login-tab-staff').click();
    await expect(page.getByTestId('staff-submit')).toHaveText('เข้าสู่ระบบเจ้าหน้าที่ (SSO ภาครัฐ จำลอง)');
    await page.getByTestId('staff-username').fill(username);
    await page.getByTestId('staff-password').fill('Test@1234'); await page.getByTestId('staff-submit').click();
    await expect(page).toHaveURL(url => url.pathname === landing);
    await expect(page.getByTestId('user-name')).toHaveText(name);
    await expect(page.getByTestId('user-role')).toHaveText(roleText);
    await expect(page.getByTestId('user-role')).toHaveAttribute('data-role', role);
    if (dept) await expect(page.getByTestId('user-role')).toHaveAttribute('data-dept', dept);
    await page.getByTestId('logout-btn').click(); await expect(page).toHaveURL(/\/login$/);
    await page.goto('/officer/queue'); await expect(page).toHaveURL(/\/login$/);
  }
  const { page, api } = await h.anonymous();
  await page.goto('/login'); await page.getByTestId('login-tab-staff').click();
  for (const [username, password] of [['off.reg1', 'wrong'], ['nobody', 'Test@1234'], ['1101700123456', 'Test@1234']]) {
    await page.getByTestId('staff-username').fill(username); await page.getByTestId('staff-password').fill(password);
    await page.getByTestId('staff-submit').click();
    await expect(page.getByTestId('staff-error')).toHaveText('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    await error(await api.post('/api/auth/staff/login', { data: { username, password } }), 401, 'INVALID_CREDENTIALS');
  }
});

test('TC-FEE-01 ค่าธรรมเนียม SV-01/SV-02/SV-03', async ({ h }) => {
  const { page, api } = await h.citizen();
  await page.goto('/citizen/new/SV-03');
  const areas: [number, string, number | null, string?, string?][] = [
    [0, '–', null, 'กรุณาระบุพื้นที่ 1–500 ตร.ม.', 'INVALID_AREA'],
    [-1, '–', null, 'กรุณาระบุพื้นที่ 1–500 ตร.ม.', 'INVALID_AREA'],
    [1, '฿1,000', 1000], [100, '฿1,000', 1000], [101, '฿1,010', 1010],
    [102, '฿1,020', 1020], [250, '฿2,500', 2500], [300, '฿3,000', 3000],
    [499, '฿4,990', 4990], [500, '฿5,000', 5000],
    [501, '–', null, 'พื้นที่เกิน 500 ตร.ม. กรุณายื่นที่สำนักงาน', 'AREA_TOO_LARGE'],
  ];
  for (const [areaSqm, text, fee, message, code] of areas) {
    await page.getByTestId('area-input').fill(String(areaSqm));
    await expect(page.getByTestId('fee-total')).toHaveText(text);
    const response = await api.post('/api/drafts', { data: { serviceId: 'SV-03', areaSqm } });
    if (fee === null) {
      await expect(page.getByTestId('fee-error')).toHaveText(message!);
      await expect(page.getByTestId('to-upload-btn')).toBeDisabled();
      await error(response, 400, code!, message);
    } else {
      await expect(page.getByTestId('fee-error')).not.toBeVisible();
      await expect(page.getByTestId('to-upload-btn')).toBeEnabled(); expect((await json(response, 201)).fee).toBe(fee);
    }
  }
  await page.goto('/citizen/new/SV-01');
  for (const [qty, text, fee] of [[0, '–', null], [1, '฿20', 20], [2, '฿40', 40], [3, '฿60', 60], [4, '฿80', 80], [5, '฿100', 100], [6, '–', null]] as const) {
    await page.getByTestId('qty-input').fill(String(qty));
    await expect(page.getByTestId('fee-total')).toHaveText(text);
    const response = await api.post('/api/drafts', { data: { serviceId: 'SV-01', qty } });
    if (fee === null) {
      await expect(page.getByTestId('fee-error')).toHaveText('จำนวนฉบับต้อง 1–5 ฉบับ');
      await expect(page.getByTestId('to-upload-btn')).toBeDisabled(); await error(response, 400, 'INVALID_QTY');
    } else {
      expect((await json(response, 201)).fee).toBe(fee);
      await expect(page.getByTestId('fee-error')).not.toBeVisible();
    }
  }
  await page.goto('/citizen/new/SV-02');
  await expect(page.getByTestId('qty-input')).toHaveCount(0); await expect(page.getByTestId('area-input')).toHaveCount(0);
  await expect(page.getByTestId('fee-total')).toHaveText('฿500');
  expect((await createDraft(api, 'SV-02')).fee).toBe(500);
});

test('TC-SUBMIT-01 ยื่นคำขอ SV-01 ครบวงจร', async ({ h }) => {
  const { page, api } = await h.citizen();
  await page.goto('/citizen'); await page.getByTestId('start-service-SV-01').click();
  await expect(page.getByTestId('wizard-step')).toHaveText('1/3 กรอกข้อมูล');
  await page.getByTestId('qty-input').fill('2'); await expect(page.getByTestId('fee-total')).toHaveText('฿40');
  await page.getByTestId('to-upload-btn').click();
  await expect(page.getByTestId('wizard-step')).toHaveText('2/3 แนบเอกสาร');
  await expect(page.getByTestId('to-payment-btn')).toBeDisabled();
  await uiUpload(page, 'id-card', 'id-card.pdf');
  await expect(page.getByTestId('file-item')).toHaveCount(1);
  await expect(page.getByTestId('file-item')).toHaveAttribute('data-doc-key', 'id-card');
  await expect(page.getByTestId('to-payment-btn')).toBeEnabled(); await page.getByTestId('to-payment-btn').click();
  await expect(page.getByTestId('wizard-step')).toHaveText('3/3 ชำระเงิน');
  await expect(page.getByTestId('payment-amount')).toHaveText('฿40'); await page.getByTestId('create-qr-btn').click();
  await expect(page.getByTestId('qr-ref')).toHaveText('PP-0002');
  await expect(page.getByTestId('qr-expires')).toHaveAttribute('data-iso', '2026-12-01T09:15:00+07:00');
  await expect(page.getByTestId('payment-status')).toHaveText('รอชำระ');
  expect(await json(await pay(api, 'PP-0002', 40))).toEqual({ status: 'PAID', caseNo: 'EG-2569-000031', receiptNo: 'RC-2569-000031', duplicate: false });
  await page.getByTestId('refresh-payment-btn').click();
  await expect(page.getByTestId('payment-status')).toHaveText('ชำระแล้ว');
  await expect(page.getByTestId('submitted-case-no')).toHaveText('EG-2569-000031');
  await expect(page.getByTestId('receipt-no')).toHaveText('RC-2569-000031');
  await expect(page.getByTestId('receipt-amount')).toHaveText('฿40');
  await expect(page.getByTestId('receipt-paid-at')).toHaveAttribute('data-iso', INITIAL_NOW);
  await page.getByTestId('go-case-btn').click(); await expect(page).toHaveURL(/\/citizen\/cases\/EG-2569-000031$/);
  await expect(page.getByTestId('case-status')).toHaveText('ส่งคำขอแล้ว');
  await expect(page.getByTestId('case-status')).toHaveAttribute('data-status', 'SUBMITTED');
  await expect(page.getByTestId('case-fee')).toHaveText('฿40');
  await expect(page.getByTestId('sla-due')).toHaveText('4 ธ.ค. 2569 16:30');
  await expect(page.getByTestId('sla-due')).toHaveAttribute('data-iso', '2026-12-04T16:30:00+07:00');
  await expect(page.getByTestId('sla-level')).toHaveText('ปกติ');
  await expect(page.getByTestId('cancel-case-btn')).toHaveCount(1); await expect(page.getByTestId('case-step')).toHaveCount(0);
  const officer = await h.staff('off.reg1'); await officer.page.goto('/officer/queue');
  await expect(row(officer.page, 31)).toHaveCount(1); await expect(row(officer.page, 31).getByTestId('row-owner')).toBeEmpty();
  await expect(row(officer.page, 31).getByTestId('claim-btn')).toHaveCount(1);
  const group = await officer.page.getByTestId('queue-row').filter({ has: officer.page.locator('[data-testid="row-due"][data-iso="2026-12-04T16:30:00+07:00"]') }).evaluateAll(els => els.map(el => el.getAttribute('data-case-no')));
  expect(group).toEqual([13, 15, 27, 28, 29, 30, 31].map(caseNo));
});

test('TC-SUBMIT-02 เอกสารบังคับครบก่อนชำระ', async ({ h }) => {
  const s = await h.citizen(); const { page, api } = s;
  await openUpload(s, 'SV-02'); await uiUpload(page, 'id-card', 'id-card.pdf');
  await expect(page.getByTestId('to-payment-btn')).toBeDisabled();
  await expect(page.getByTestId('missing-docs')).toHaveText('ยังขาดเอกสาร: แผนที่ตั้ง');
  await uiUpload(page, 'map', 'map.pdf'); await expect(page.getByTestId('to-payment-btn')).toBeEnabled();
  await expect(page.getByTestId('missing-docs')).toHaveCount(0);
  await removeFile(page, 'map.pdf'); await expect(page.getByTestId('to-payment-btn')).toBeDisabled();
  await expect(page.getByTestId('missing-docs')).toHaveText('ยังขาดเอกสาร: แผนที่ตั้ง');
  const draftId = await openUpload(s, 'SV-03', '100'); await uiUpload(page, 'id-card', 'id-card.pdf');
  await expect(page.getByTestId('to-payment-btn')).toBeDisabled();
  await expect(page.getByTestId('missing-docs')).toHaveText('ยังขาดเอกสาร: แบบแปลน, โฉนด');
  await uiUpload(page, 'deed', 'deed.pdf'); await expect(page.getByTestId('to-payment-btn')).toBeDisabled();
  await expect(page.getByTestId('missing-docs')).toHaveText('ยังขาดเอกสาร: แบบแปลน');
  await uiUpload(page, 'plan', 'plan-as-jpg.jpg', 400);
  await error(await upload(api, draftId, 'plan', 'plan-as-jpg.jpg'), 400, 'PLAN_NOT_PDF');
  await expect(page.getByTestId('upload-error')).toHaveText('แบบแปลนต้องเป็นไฟล์ PDF เท่านั้น');
  await expect(page.getByTestId('file-item')).toHaveCount(2); await expect(page.getByTestId('to-payment-btn')).toBeDisabled();
  await expect(page.getByTestId('missing-docs')).toHaveText('ยังขาดเอกสาร: แบบแปลน');
  expect((await error(await api.post(`/api/drafts/${draftId}/payment`), 409, 'MISSING_DOCS')).missing).toEqual(['แบบแปลน']);
  await uiUpload(page, 'plan', 'plan.pdf'); await expect(page.getByTestId('to-payment-btn')).toBeEnabled();
  await expect(page.getByTestId('missing-docs')).toHaveCount(0);
  await json(await api.post(`/api/drafts/${draftId}/payment`), 201);
});

test('TC-SUBMIT-03 ร่าง การลบร่าง และการยกเลิก', async ({ h }) => {
  let s = await h.citizen();
  await s.page.goto('/citizen'); await expect(s.page.getByTestId('my-case-row')).toHaveCount(10);
  await expect(s.page.getByTestId('my-draft-row')).toHaveCount(2);
  for (const [id, status] of [['DR-0001', 'DRAFT'], ['DR-0002', 'PENDING_PAYMENT']]) {
    const draft = s.page.locator(`[data-testid="my-draft-row"][data-draft-id="${id}"]`);
    await expect(draft).toHaveAttribute('data-status', status); await expect(draft).not.toContainText('EG-');
  }
  await s.page.locator('[data-testid="my-draft-row"][data-draft-id="DR-0001"]').getByTestId('open-draft-btn').click();
  await expect(s.page.getByTestId('qty-input')).toHaveValue('2'); await expect(s.page.getByTestId('fee-total')).toHaveText('฿40');
  await s.page.goto('/citizen/new/SV-01'); await s.page.getByTestId('qty-input').fill('3');
  await s.page.getByTestId('save-draft-btn').click(); await expect(s.page.getByTestId('draft-id')).toHaveText('DR-0003');
  await s.page.goto('/citizen'); await expect(s.page.getByTestId('my-case-row')).toHaveCount(10);
  expect((await json(await s.api.get('/api/cases'))).items).toHaveLength(10);
  expect((await json(await s.api.get('/api/drafts'))).items).toHaveLength(3);

  await h.reset(); s = await h.citizen();
  await s.page.goto(`/citizen/cases/${caseNo(30)}`); await expect(s.page.getByTestId('cancel-case-btn')).toHaveCount(1);
  await s.page.getByTestId('cancel-case-btn').click();
  await expect(s.page.getByTestId('cancel-confirm-text')).toHaveText('ค่าธรรมเนียมที่ชำระแล้วไม่คืน');
  await s.page.getByTestId('confirm-cancel-btn').click();
  await expect(s.page.getByTestId('case-status')).toHaveText('ยกเลิก');
  await expect(s.page.getByTestId('case-status')).toHaveAttribute('data-status', 'CANCELLED');
  await expect(s.page.getByTestId('no-refund-note')).toHaveText('ค่าธรรมเนียมที่ชำระแล้วไม่คืน');
  await expect(s.page.getByTestId('cancel-case-btn')).toHaveCount(0);
  let officer = await h.staff('off.reg1'); await officer.page.goto('/officer/queue');
  await expect(officer.page.getByTestId('queue-row')).toHaveCount(16); await expect(row(officer.page, 30)).toHaveCount(0);
  const executive = await h.staff('exec1'); await executive.page.goto('/dashboard');
  await expect(executive.page.getByTestId('kpi-backlog')).toHaveText('20');
  await expect(executive.page.getByTestId('kpi-received')).toHaveText('3');

  await h.reset(); officer = await h.staff('off.reg1'); await json(await claim(officer.api, 30)); s = await h.citizen();
  await s.page.goto(`/citizen/cases/${caseNo(30)}`);
  await expect(s.page.getByTestId('case-status')).toHaveText('กำลังตรวจสอบ');
  await expect(s.page.getByTestId('cancel-case-btn')).toHaveCount(0);
  for (const n of [30, 13]) await error(await s.api.post(`/api/cases/${caseNo(n)}/cancel`), 409, 'CANNOT_CANCEL', 'ยกเลิกไม่ได้ คำขอมีเจ้าหน้าที่รับเรื่องแล้ว');

  await h.reset(); s = await h.citizen();
  expect((await s.api.delete('/api/drafts/DR-0001')).status()).toBe(204);
  expect((await s.api.get('/api/drafts/DR-0001')).status()).toBe(404);
  await s.page.goto('/citizen'); await expect(s.page.getByTestId('my-draft-row')).toHaveCount(1);
  await expect(s.page.getByTestId('my-draft-row')).toHaveAttribute('data-draft-id', 'DR-0002');
  expect((await s.api.delete('/api/drafts/DR-0002')).status()).toBe(204);
  expect((await s.api.get('/api/payments/PP-0001')).status()).toBe(404);
  expect((await pay(s.api, 'PP-0001', 500)).status()).toBe(404);
  expect((await json(await s.api.get('/api/cases'))).items).toHaveLength(10);

  await h.reset(); s = await h.citizen(); officer = await h.staff('off.reg1');
  const [cancelled, claimed] = await Promise.all([s.api.post(`/api/cases/${caseNo(30)}/cancel`), claim(officer.api, 30)]);
  expect([cancelled.status(), claimed.status()].sort()).toEqual([200, 409]);
  const final = await getCase(officer.api, 30);
  if (cancelled.status() === 200) {
    await error(claimed, 409, 'INVALID_STATE'); expect(final.status).toBe('CANCELLED'); expect(final.owner ?? '').toBe('');
  } else {
    await error(cancelled, 409, 'CANNOT_CANCEL'); expect(final.status).toBe('IN_REVIEW'); expect(final.owner).toBe('off.reg1');
  }
  await officer.page.goto('/officer/queue');
  await expect(officer.page.getByTestId('workload-count')).toHaveText(cancelled.status() === 200 ? '3' : '4');
});

test('TC-UPLOAD-01 ขนาดและจำนวนไฟล์', async ({ h }) => {
  const s = await h.citizen(); const { page, api } = s;
  const draftId = await openUpload(s);
  for (const size of [5242879, 5242880, 5242881]) {
    const name = `size-${size}.pdf`;
    expect(testFile(name, size).buffer.length).toBe(size);
    await uiUpload(page, 'id-card', name, size > 5242880 ? 400 : 201, size);
    if (size > 5242880) {
      await expect(page.getByTestId('upload-error')).toHaveText('ไฟล์ใหญ่เกิน 5 MB');
      await expect(page.getByTestId('file-item')).toHaveCount(0);
    } else {
      await expect(page.getByTestId('file-item')).toHaveCount(1); await expect(page.getByTestId('upload-error')).not.toBeVisible();
      await removeFile(page, name);
    }
    const apiDraft = await createDraft(api);
    const direct = await upload(api, apiDraft.draftId, 'id-card', name, size);
    if (size > 5242880) await error(direct, 400, 'FILE_TOO_LARGE', 'ไฟล์ใหญ่เกิน 5 MB');
    else expect((await json(direct, 201)).size).toBe(size);
  }
  await uiUpload(page, 'id-card', 'id-card.pdf');
  for (const n of [1, 2, 3, 4]) await uiUpload(page, 'extra', `multi-${n}.pdf`);
  await expect(page.getByTestId('file-item')).toHaveCount(5);
  await uiUpload(page, 'extra', 'multi-5.pdf', 400);
  await expect(page.getByTestId('upload-error')).toHaveText('แนบได้สูงสุด 5 ไฟล์ต่อคำขอ');
  await expect(page.getByTestId('file-item')).toHaveCount(5);
  await error(await upload(api, draftId, 'extra', 'multi-5.pdf'), 400, 'FILE_COUNT');
  await removeFile(page, 'multi-1.pdf'); await uiUpload(page, 'extra', 'multi-5.pdf');
  await expect(page.getByTestId('file-item')).toHaveCount(5);
});

test('TC-UPLOAD-02 ชนิดไฟล์จากเนื้อไฟล์', async ({ h }) => {
  const s = await h.citizen(); const { page, api } = s;
  const draftId = await openUpload(s);
  for (const name of ['ok-id.pdf', 'real.jpg', 'real.png']) {
    await uiUpload(page, 'id-card', name); await expect(page.getByTestId('file-item')).toHaveCount(1);
    await removeFile(page, name);
    const directDraft = await createDraft(api); await json(await upload(api, directDraft.draftId, 'id-card', name), 201);
  }
  const beforeRejectedFiles = await json(await api.get(`/api/drafts/${draftId}`));
  for (const name of ['fake-text.pdf', 'fake-text.jpg', 'exe-as.png', 'notes.txt', 'fake-text.pdf']) {
    // fake-text.pdf deliberately advertises application/pdf in both browser and API.
    await uiUpload(page, 'id-card', name, 400);
    await expect(page.getByTestId('upload-error')).toHaveText('รองรับเฉพาะไฟล์ PDF, JPG, PNG');
    await expect(page.getByTestId('file-item')).toHaveCount(0);
    await error(await upload(api, draftId, 'id-card', name), 400, 'FILE_TYPE');
    const detail = await json(await api.get(`/api/drafts/${draftId}`));
    expect(detail).toEqual(beforeRejectedFiles);
  }
});

test('TC-PAY-01 อายุ QR 15:00', async ({ h }) => {
  const rounds = [
    ['2026-12-01T09:00:00+07:00', 200], ['2026-12-01T09:09:59+07:00', 200],
    ['2026-12-01T09:10:00+07:00', 410], ['2026-12-01T09:10:01+07:00', 410],
  ] as const;
  for (const [now, status] of rounds) {
    await h.reset(); await h.clock(now); const s = await h.citizen();
    const response = await pay(s.api, 'PP-0001', 500);
    if (status === 200) expect(await json(response)).toMatchObject({ status: 'PAID', caseNo: 'EG-2569-000031' });
    else {
      await error(response, 410, 'QR_EXPIRED');
      expect((await json(await s.api.get('/api/payments/PP-0001'))).status).toBe('EXPIRED');
      expect((await json(await s.api.get('/api/cases'))).items).toHaveLength(10);
    }
    if (now === '2026-12-01T09:10:00+07:00') {
      await s.page.goto('/citizen/new/SV-02?draft=DR-0002');
      await expect(s.page.getByTestId('qr-expired-msg')).toHaveText('QR หมดอายุ กรุณาสร้าง QR ใหม่');
      await expect(s.page.getByTestId('payment-status')).toHaveText('QR หมดอายุ');
      await expect(s.page.getByTestId('payment-status')).toHaveAttribute('data-status', 'EXPIRED');
      await expect(s.page.getByTestId('regenerate-qr-btn')).toHaveCount(1); await s.page.getByTestId('regenerate-qr-btn').click();
      await expect(s.page.getByTestId('qr-ref')).toHaveText('PP-0002');
      await expect(s.page.getByTestId('qr-expires')).toHaveAttribute('data-iso', '2026-12-01T09:25:00+07:00');
      expect((await json(await pay(s.api, 'PP-0002', 500))).caseNo).toBe('EG-2569-000031');
    }
  }
});

test('TC-PAY-02 ยอดเงินและ callback ซ้ำ', async ({ h }) => {
  const { api } = await h.citizen(); const payment = await readyPayment(api);
  expect(payment.ref).toBe('PP-0002'); expect(payment.amount).toBe(20);
  for (const amount of [19, 21]) {
    await error(await pay(api, payment.ref, amount), 422, 'AMOUNT_MISMATCH');
    expect((await json(await api.get('/api/payments/PP-0002'))).status).toBe('PENDING');
    expect((await json(await api.get('/api/cases'))).items).toHaveLength(10);
  }
  expect(await json(await pay(api, payment.ref, 20))).toMatchObject({ status: 'PAID', caseNo: 'EG-2569-000031', receiptNo: 'RC-2569-000031', duplicate: false });
  expect((await json(await api.get('/api/cases'))).items).toHaveLength(11);
  expect(await json(await pay(api, payment.ref, 20))).toMatchObject({ duplicate: true, caseNo: 'EG-2569-000031', receiptNo: 'RC-2569-000031' });
  expect((await json(await api.get('/api/cases'))).items).toHaveLength(11);
  const next = await readyPayment(api);
  expect(await json(await pay(api, next.ref, 20))).toMatchObject({ caseNo: 'EG-2569-000032', receiptNo: 'RC-2569-000032' });
});

test('TC-PAY-03 ชำระพร้อมกัน เลขไม่ซ้ำ', async ({ h }) => {
  const somchai = await h.citizen(); const somying = await h.citizen(CITIZENS.somying);
  const payments: { api: typeof somchai.api; ref: string }[] = [];
  for (const s of [somchai, somying]) for (let i = 0; i < 3; i++) payments.push({ api: s.api, ref: (await readyPayment(s.api)).ref });
  expect(payments.map(p => p.ref)).toEqual(['PP-0002', 'PP-0003', 'PP-0004', 'PP-0005', 'PP-0006', 'PP-0007']);
  const responses = await Promise.all(payments.map(p => pay(p.api, p.ref, 20)));
  const paid = await Promise.all(responses.map(r => json(r)));
  expect(new Set(paid.map(p => p.caseNo)).size).toBe(6);
  expect(paid.map(p => p.caseNo).sort()).toEqual([31, 32, 33, 34, 35, 36].map(caseNo));
  expect(paid.map(p => p.receiptNo).sort()).toEqual(['RC-2569-000031', 'RC-2569-000032', 'RC-2569-000033', 'RC-2569-000034', 'RC-2569-000035', 'RC-2569-000036']);
  for (const s of [somchai, somying]) {
    const items = (await json(await s.api.get('/api/cases'))).items;
    const newCases = items.filter((item: { caseNo: string }) => ['EG-2569-000031', 'EG-2569-000032', 'EG-2569-000033', 'EG-2569-000034', 'EG-2569-000035', 'EG-2569-000036'].includes(item.caseNo));
    expect(newCases).toHaveLength(3);
    const ownRefs = payments.filter(p => p.api === s.api);
    const ownCases = await Promise.all(ownRefs.map(async p => (await json(await s.api.get(`/api/payments/${p.ref}`))).caseNo));
    expect(newCases.map((c: { caseNo: string }) => c.caseNo).sort()).toEqual(ownCases.sort());
  }
  const next = await readyPayment(somchai.api); expect((await json(await pay(somchai.api, next.ref, 20))).caseNo).toBe('EG-2569-000037');
});

test('TC-PAY-04 เลขคำขอข้ามปี 2569 → 2570', async ({ h }) => {
  const s = await h.citizen();
  await h.clock('2026-12-31T23:58:00+07:00'); const first = await readyPayment(s.api);
  const pending = await json(await s.api.get(`/api/payments/${first.ref}`)); expect(pending.caseNo ?? null).toBeNull();
  await h.clock('2026-12-31T23:59:00+07:00');
  expect(await json(await pay(s.api, first.ref, 20))).toMatchObject({ caseNo: 'EG-2569-000031', receiptNo: 'RC-2569-000031' });
  await s.page.goto(`/citizen/new/SV-01?draft=${first.draftId}`);
  await expect(s.page.getByTestId('receipt-paid-at')).toHaveAttribute('data-iso', '2026-12-31T23:59:00+07:00');
  await h.clock('2027-01-01T00:00:00+07:00'); const second = await readyPayment(s.api);
  expect(await json(await pay(s.api, second.ref, 20))).toMatchObject({ caseNo: 'EG-2570-000001', receiptNo: 'RC-2570-000001' });
  const third = await readyPayment(s.api); expect((await json(await pay(s.api, third.ref, 20))).caseNo).toBe('EG-2570-000002');
  expect((await getCase(s.api, 31)).caseNo).toBe('EG-2569-000031');
});

test('TC-QUEUE-01 ลำดับคิวและขอบเขตแผนก', async ({ h }) => {
  const first = await h.staff('off.reg1'); const { page } = first;
  const ids = async (p: typeof page) => p.getByTestId('queue-row').evaluateAll(els => els.map(el => el.getAttribute('data-case-no')));
  await page.goto('/officer/queue'); await expect(page.getByTestId('queue-filter')).toHaveValue('all');
  await expect(page.getByTestId('queue-row')).toHaveCount(17);
  const expected = [20, 22, 24, 23, 25, 26, 13, 15, 27, 28, 29, 30, 16, 18, 19, 12, 21].map(caseNo);
  expect(await ids(page)).toEqual(expected);
  expect((await json(await first.api.get('/api/officer/queue?filter=all'))).items.map((c: { caseNo: string }) => c.caseNo)).toEqual(expected);
  for (const [index, text] of ['เกินกำหนด', 'ใกล้ครบกำหนด', 'ใกล้ครบกำหนด'].entries()) await expect(page.getByTestId('queue-row').nth(index).getByTestId('row-sla-level')).toHaveText(text);
  for (const mask of await page.getByTestId('row-id-masked').allTextContents()) expect(mask).toMatch(/^X-XXXX-XXXXX-\d{2}-\d$/);
  await expect(page.getByTestId('claim-btn')).toHaveCount(4);
  for (const n of [24, 28, 29, 30]) await expect(row(page, n).getByTestId('claim-btn')).toHaveCount(1);
  for (const n of [20, 22, 23, 25, 26, 13, 15, 27, 16, 18, 19, 12, 21]) await expect(row(page, n).getByTestId('claim-btn')).toHaveCount(0);
  await page.getByTestId('queue-filter').selectOption('unclaimed'); await expect(page.getByTestId('queue-row')).toHaveCount(4);
  expect(await ids(page)).toEqual([24, 28, 29, 30].map(caseNo));
  await page.getByTestId('queue-filter').selectOption('mine'); await expect(page.getByTestId('queue-row')).toHaveCount(3);
  expect(await ids(page)).toEqual([20, 22, 23].map(caseNo)); await expect(page.getByTestId('workload-count')).toHaveText('3');
  const second = await h.staff('off.reg2'); await second.page.goto('/officer/queue');
  await second.page.getByTestId('queue-filter').selectOption('mine'); await expect(second.page.getByTestId('queue-row')).toHaveCount(9);
  expect(await ids(second.page)).toEqual([25, 26, 13, 15, 27, 16, 18, 12, 21].map(caseNo));
  await expect(second.page.getByTestId('workload-count')).toHaveText('9');
  const works = await h.staff('off.works1'); await works.page.goto('/officer/queue');
  await expect(works.page.getByTestId('queue-row')).toHaveCount(1); expect(await ids(works.page)).toEqual(['EG-2569-000010']);
  const head = await h.staff('head1'); await head.page.goto('/officer/queue'); await expect(head.page.getByTestId('queue-row')).toHaveCount(18);
  const headIds = await ids(head.page); expect(new Set(headIds)).toEqual(new Set([...expected, 'EG-2569-000010']));
  expect(headIds.filter(id => [10, 23, 25, 26].map(caseNo).includes(id!))).toEqual([10, 23, 25, 26].map(caseNo));
  await expect(head.page.getByTestId('claim-btn')).toHaveCount(0);
  for (const n of [17, 11, 14, 1, 2, 3, 4, 5, 6, 7, 8, 9]) await expect(row(head.page, n)).toHaveCount(0);
});

test('TC-QUEUE-02 รับเรื่องซ้อน พร้อมกันและต่อกัน', async ({ h }) => {
  let a = await h.staff('off.reg1'); let b = await h.staff('off.reg2');
  await Promise.all([a.page.goto('/officer/queue'), b.page.goto('/officer/queue')]);
  for (const s of [a, b]) await expect(row(s.page, 28).getByTestId('claim-btn')).toHaveCount(1);
  const responses = [
    a.page.waitForResponse(r => r.url().endsWith(`/api/officer/cases/${caseNo(28)}/claim`)),
    b.page.waitForResponse(r => r.url().endsWith(`/api/officer/cases/${caseNo(28)}/claim`)),
  ];
  await Promise.all([row(a.page, 28).getByTestId('claim-btn').click(), row(b.page, 28).getByTestId('claim-btn').click()]);
  const [ra, rb] = await Promise.all(responses);
  expect([ra.status(), rb.status()].sort()).toEqual([200, 409]);
  const winner = ra.status() === 200 ? 'off.reg1' : 'off.reg2';
  const loser = ra.status() === 409 ? a : b;
  const winnerSession = ra.status() === 200 ? a : b;
  const losingBody = await json(ra.status() === 409 ? ra : rb, 409); expect(losingBody.code).toBe('ALREADY_CLAIMED');
  await expect(loser.page.getByTestId('action-error')).toHaveText('มีเจ้าหน้าที่รับเรื่องนี้แล้ว');
  await expect(row(winnerSession.page, 28).getByTestId('row-owner')).toHaveText(winner);
  expect(await getCase(a.api, 28)).toMatchObject({ owner: winner, status: 'IN_REVIEW' }); await assertClaimAudit(h, 28);

  await h.reset(); a = await h.staff('off.reg1'); b = await h.staff('off.reg2');
  const raced = await Promise.all(Array.from({ length: 10 }, (_, i) => claim(i < 5 ? a.api : b.api, 29)));
  expect(raced.filter(r => r.status() === 200)).toHaveLength(1);
  const failures = raced.filter(r => r.status() !== 200); expect(failures).toHaveLength(9);
  for (const r of failures) await error(r, 409, 'ALREADY_CLAIMED');
  const success = await json(raced.find(r => r.status() === 200)!);
  expect(['off.reg1', 'off.reg2']).toContain(success.owner);
  expect(await getCase(a.api, 29)).toMatchObject({ owner: success.owner, status: 'IN_REVIEW' }); await assertClaimAudit(h, 29);

  await h.reset(); a = await h.staff('off.reg1'); b = await h.staff('off.reg2');
  expect((await json(await claim(a.api, 29))).owner).toBe('off.reg1');
  await error(await claim(b.api, 29), 409, 'ALREADY_CLAIMED', 'มีเจ้าหน้าที่รับเรื่องนี้แล้ว');
  expect((await getCase(a.api, 29)).owner).toBe('off.reg1');
  await b.page.goto('/officer/queue'); await expect(b.page.getByTestId('workload-count')).toHaveText('9');
  await error(await claim(a.api, 29), 409, 'ALREADY_CLAIMED'); await assertClaimAudit(h, 29);
});

test('TC-QUEUE-03 งานในมือสูงสุด 10', async ({ h }) => {
  let s = await h.staff('off.reg2');
  const workload = async (text: string) => {
    await s.page.goto('/officer/queue'); await expect(s.page.getByTestId('workload-count')).toHaveText(text);
  };
  await workload('9'); await row(s.page, 28).getByTestId('claim-btn').click();
  await expect(s.page.getByTestId('workload-count')).toHaveText('10');
  const failedResponse = s.page.waitForResponse(r => r.url().endsWith(`/api/officer/cases/${caseNo(29)}/claim`));
  await row(s.page, 29).getByTestId('claim-btn').click();
  expect((await json(await failedResponse, 409)).code).toBe('WORKLOAD_LIMIT');
  await expect(s.page.getByTestId('action-error')).toHaveText('รับงานได้สูงสุด 10 เรื่อง');
  await expect(s.page.getByTestId('workload-count')).toHaveText('10');
  const unclaimed = await getCase(s.api, 29); expect(unclaimed.status).toBe('SUBMITTED'); expect(unclaimed.owner ?? '').toBe('');
  await s.page.goto(`/officer/cases/${caseNo(25)}`); await s.page.getByTestId('approve-btn').click();
  await expect(s.page.getByTestId('case-status')).toHaveAttribute('data-status', 'APPROVED'); await workload('9');
  await row(s.page, 29).getByTestId('claim-btn').click(); await expect(s.page.getByTestId('workload-count')).toHaveText('10');
  const first = await h.staff('off.reg1'); await json(await claim(first.api, 30));

  await h.reset(); s = await h.staff('off.reg2');
  await json(await s.api.post(`/api/officer/cases/${caseNo(25)}/return`, { data: { reason: 'xxxxxxxxxx' } }));
  await s.page.goto(`/officer/cases/${caseNo(25)}`); await expect(s.page.getByTestId('case-status')).toHaveText('รอแก้ไขเอกสาร');
  await workload('8'); await json(await claim(s.api, 28)); await json(await claim(s.api, 29)); await workload('10');
  const citizen = await h.citizen(CITIZENS.somying); await citizen.page.goto(`/citizen/cases/${caseNo(25)}`);
  await citizen.page.getByTestId('submit-fix-btn').click(); await expect(citizen.page.getByTestId('case-status')).toHaveText('กำลังตรวจสอบ');
  expect(await getCase(s.api, 25)).toMatchObject({ owner: 'off.reg2', status: 'IN_REVIEW' }); await workload('11');
  await error(await claim(s.api, 30), 409, 'WORKLOAD_LIMIT', 'รับงานได้สูงสุด 10 เรื่อง'); await workload('11');
});

test('TC-SLA-01 กำหนดเสร็จตามตารางวันที่', async ({ h }) => {
  const rows = [
    ['SV-01', '2026-12-01T09:00:00+07:00', '2026-12-04T16:30:00+07:00', '4 ธ.ค. 2569 16:30'],
    ['SV-01', '2026-12-01T16:29:00+07:00', '2026-12-04T16:30:00+07:00', '4 ธ.ค. 2569 16:30'],
    ['SV-01', '2026-12-01T16:30:00+07:00', '2026-12-08T16:30:00+07:00', '8 ธ.ค. 2569 16:30'],
    ['SV-01', '2026-12-04T10:00:00+07:00', '2026-12-11T16:30:00+07:00', '11 ธ.ค. 2569 16:30'],
    ['SV-01', '2026-12-05T10:00:00+07:00', '2026-12-14T16:30:00+07:00', '14 ธ.ค. 2569 16:30'],
    ['SV-02', '2026-12-01T09:00:00+07:00', '2026-12-17T16:30:00+07:00', '17 ธ.ค. 2569 16:30'],
    ['SV-03', '2026-12-01T09:00:00+07:00', '2026-12-24T16:30:00+07:00', '24 ธ.ค. 2569 16:30'],
    ['SV-01', '2026-12-29T10:00:00+07:00', '2027-01-05T16:30:00+07:00', '5 ม.ค. 2570 16:30'],
    ['SV-01', '2026-12-31T23:59:00+07:00', '2027-01-07T16:30:00+07:00', '7 ม.ค. 2570 16:30'],
  ];
  for (const [service, now, dueAt, text] of rows) {
    await test.step(`${service} paid ${now}`, async () => {
      await h.reset(); const s = await newPaid(h, service, now);
      expect(s.paid.caseNo).toBe('EG-2569-000031'); expect((await getCase(s.api, 31)).dueAt).toBe(dueAt);
      await s.page.goto('/citizen/cases/EG-2569-000031');
      await expect(s.page.getByTestId('sla-due')).toHaveAttribute('data-iso', dueAt);
      await expect(s.page.getByTestId('sla-due')).toHaveText(text);
    });
  }
});

test('TC-SLA-02 หยุดนับ SLA ระหว่างรอแก้ไข', async ({ h }) => {
  const s = await newPaid(h);
  expect((await getCase(s.api, 31)).dueAt).toBe('2026-12-04T16:30:00+07:00');
  await h.clock('2026-12-02T11:00:00+07:00'); const officer = await h.staff('off.reg1');
  await json(await claim(officer.api, 31));
  await json(await officer.api.post(`/api/officer/cases/${caseNo(31)}/return`, { data: { reason: 'xxxxxxxxxx' } }));
  await officer.page.goto(`/officer/cases/${caseNo(31)}`); await expect(officer.page.getByTestId('case-status')).toHaveText('รอแก้ไขเอกสาร');
  await assertLevel(s, 31, 'หยุดนับ', 'paused');
  await expect(s.page.getByTestId('fix-deadline')).toHaveAttribute('data-iso', '2026-12-09T11:00:00+07:00');
  await h.clock('2026-12-03T10:00:00+07:00');
  expect((await json(await s.api.post(`/api/cases/${caseNo(31)}/resubmit`))).dueAt).toBe('2026-12-08T16:30:00+07:00');
  await s.page.reload(); await expect(s.page.getByTestId('case-status')).toHaveText('กำลังตรวจสอบ');
  await expect(s.page.getByTestId('sla-due')).toHaveText('8 ธ.ค. 2569 16:30');
  await expect(s.page.getByTestId('sla-due')).toHaveAttribute('data-iso', '2026-12-08T16:30:00+07:00');
  await assertLevel(s, 31, 'ปกติ', 'normal');
  await officer.page.reload(); await expect(officer.page.getByTestId('case-owner')).toHaveText('off.reg1');

  await h.reset(); let seed = await h.citizen(); await assertLevel(seed, 17, 'หยุดนับ', 'paused');
  await expect(seed.page.getByTestId('sla-due')).toHaveAttribute('data-iso', '2026-11-27T16:30:00+07:00');
  await seed.page.getByTestId('submit-fix-btn').click(); await expect(seed.page.getByTestId('case-status')).toHaveText('กำลังตรวจสอบ');
  expect(await getCase(seed.api, 17)).toMatchObject({ dueAt: '2026-12-01T16:30:00+07:00', slaLevel: 'near', owner: 'off.reg1' });
  await expect(seed.page.getByTestId('sla-due')).toHaveAttribute('data-iso', '2026-12-01T16:30:00+07:00');
  await expect(seed.page.getByTestId('sla-level')).toHaveText('ใกล้ครบกำหนด');

  await h.reset(); await h.clock('2026-12-04T10:00:00+07:00'); seed = await h.citizen();
  expect((await json(await seed.api.post(`/api/cases/${caseNo(17)}/resubmit`))).dueAt).toBe('2026-12-04T16:30:00+07:00');
  expect((await getCase(seed.api, 17)).dueAt).toBe('2026-12-04T16:30:00+07:00');
  await assertLevel(seed, 17, 'ใกล้ครบกำหนด', 'near');
  await expect(seed.page.getByTestId('sla-due')).toHaveAttribute('data-iso', '2026-12-04T16:30:00+07:00');

  for (const [returnedAt, resumedAt, dueAt, text, level] of [
    ['2026-12-02T09:00:00+07:00', '2026-12-02T15:00:00+07:00', '2026-12-04T16:30:00+07:00', 'ปกติ', 'normal'],
    ['2026-12-04T10:00:00+07:00', '2026-12-08T17:00:00+07:00', '2026-12-08T16:30:00+07:00', 'เกินกำหนด', 'overdue'],
  ]) {
    await h.reset(); const citizen = await newPaid(h); await h.clock(returnedAt); const staff = await h.staff('off.reg1');
    await json(await claim(staff.api, 31)); await json(await staff.api.post(`/api/officer/cases/${caseNo(31)}/return`, { data: { reason: 'xxxxxxxxxx' } }));
    await h.clock(resumedAt); expect((await json(await citizen.api.post(`/api/cases/${caseNo(31)}/resubmit`))).dueAt).toBe(dueAt);
    expect(await getCase(citizen.api, 31)).toMatchObject({ dueAt, owner: 'off.reg1', status: 'IN_REVIEW' });
    await assertLevel(citizen, 31, text, level); await expect(citizen.page.getByTestId('sla-due')).toHaveAttribute('data-iso', dueAt);
  }
});

test('TC-SLA-03 ระดับเตือน ปกติ/ใกล้/เกิน', async ({ h }) => {
  const s = await newPaid(h);
  for (const [now, text, level] of [
    ['2026-12-01T09:00:00+07:00', 'ปกติ', 'normal'], ['2026-12-02T09:00:00+07:00', 'ปกติ', 'normal'],
    ['2026-12-03T09:00:00+07:00', 'ใกล้ครบกำหนด', 'near'], ['2026-12-04T16:30:00+07:00', 'ใกล้ครบกำหนด', 'near'],
    ['2026-12-04T16:30:01+07:00', 'เกินกำหนด', 'overdue'], ['2026-12-04T16:31:00+07:00', 'เกินกำหนด', 'overdue'],
    ['2026-12-05T10:00:00+07:00', 'เกินกำหนด', 'overdue'],
  ]) { await h.clock(now); await assertLevel(s, 31, text, level); }
  await h.reset(); let officer = await h.staff('off.reg2');
  for (const [now, text, level] of [
    ['2026-12-03T09:00:00+07:00', 'ปกติ', 'normal'], ['2026-12-04T09:00:00+07:00', 'ใกล้ครบกำหนด', 'near'],
    ['2026-12-08T16:30:00+07:00', 'ใกล้ครบกำหนด', 'near'], ['2026-12-08T16:31:00+07:00', 'เกินกำหนด', 'overdue'],
  ]) { await h.clock(now); await assertLevel(officer, 16, text, level, true); }
  await h.reset(); officer = await h.staff('off.reg1'); await officer.page.goto('/officer/queue');
  for (const [n, text, level] of [[20, 'เกินกำหนด', 'overdue'], [22, 'ใกล้ครบกำหนด', 'near'], [24, 'ใกล้ครบกำหนด', 'near'], [25, 'ปกติ', 'normal']] as const) {
    await expect(row(officer.page, n).getByTestId('row-sla-level')).toHaveText(text);
    await expect(row(officer.page, n)).toHaveAttribute('data-sla-level', level);
  }
  for (const [n, text, level] of [[20, 'เกินกำหนด', 'overdue'], [22, 'ใกล้ครบกำหนด', 'near'], [24, 'ใกล้ครบกำหนด', 'near'], [25, 'ปกติ', 'normal'], [17, 'หยุดนับ', 'paused']] as const) await assertLevel(officer, n, text, level, true);
  const somying = await h.citizen(CITIZENS.somying); await assertLevel(somying, 1, 'ปิดแล้ว', 'closed');
  await h.clock('2026-12-01T16:30:00+07:00'); await assertLevel(officer, 22, 'ใกล้ครบกำหนด', 'near', true);
  await h.clock('2026-12-01T16:31:00+07:00'); await assertLevel(officer, 22, 'เกินกำหนด', 'overdue', true);
});
