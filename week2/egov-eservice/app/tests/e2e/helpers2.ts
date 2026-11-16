import {
  test as base, expect, request,
  type APIRequestContext, type APIResponse, type Browser, type BrowserContext,
  type Download, type Locator, type Page, type TestInfo,
} from '@playwright/test';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// Lab 4: PW_VIDEO_DIR set → record video of every browser window, one folder per TC (no effect on checks).
const videoOpts = () => process.env.PW_VIDEO_DIR
  ? { recordVideo: { dir: `${process.env.PW_VIDEO_DIR}/${base.info().title.split(' ')[0]}`, size: { width: 1024, height: 640 } } }
  : {};

// Oracles and selectors come exclusively from CONTRACT / TEST-DATA / TEST-PLAN.
export const NOW = '2026-12-01T09:00:00+07:00';
export const SOMCHAI = '1101700123456';
export const SOMYING = '3100600987659';
export const MANA = '5500400111221';
export const caseNo = (n: number) => `EG-2569-${String(n).padStart(6, '0')}`;
export const masked = /^X-XXXX-XXXXX-\d{2}-\d$/;
export const reasonError = 'กรุณากรอกเหตุผลอย่างน้อย 10 ตัวอักษร';
export const statusText: Record<string, string> = {
  DRAFT: 'ร่าง', PENDING_PAYMENT: 'รอชำระเงิน', SUBMITTED: 'ส่งคำขอแล้ว',
  IN_REVIEW: 'กำลังตรวจสอบ', NEED_FIX: 'รอแก้ไขเอกสาร', PENDING_APPROVAL: 'รออนุมัติ',
  APPROVED: 'อนุมัติ', COMPLETED: 'เสร็จสิ้น', REJECTED: 'ไม่อนุมัติ', CANCELLED: 'ยกเลิก',
};
export const levelText: Record<string, string> = {
  normal: 'ปกติ', near: 'ใกล้ครบกำหนด', overdue: 'เกินกำหนด', paused: 'หยุดนับ', closed: 'ปิดแล้ว',
};
export type Session = { context: BrowserContext; page: Page; api: APIRequestContext };
export type Json = Record<string, any>;

export async function json(response: APIResponse, status = 200): Promise<Json> {
  expect(response.status(), response.url()).toBe(status);
  expect(response.headers()['content-type']).toContain('application/json');
  return response.json();
}
export async function get(s: Session, path: string, status = 200) {
  return json(await s.api.get(path), status);
}
export async function post(s: Session, path: string, data?: unknown, status = 200) {
  return json(await s.api.post(path, data === undefined ? {} : { data }), status);
}
export async function put(s: Session, path: string, data: unknown, status = 200) {
  return json(await s.api.put(path, { data }), status);
}
export async function error(response: APIResponse, status: number, code?: string, message?: string) {
  const body = await json(response, status);
  if (code) expect(body.code).toBe(code);
  if (message) expect(body.message).toBe(message);
  return body;
}
export const row = (page: Page, testId: string, n: number) =>
  page.locator(`[data-testid="${testId}"][data-case-no="${caseNo(n)}"]`);
export async function text(page: Page, id: string, value: string | number) {
  await expect(page.getByTestId(id)).toHaveText(String(value));
}
export async function state(page: Page, code: string) {
  await text(page, 'case-status', statusText[code]);
  await expect(page.getByTestId('case-status')).toHaveAttribute('data-status', code);
}
export async function buttons(page: Page, counts: Record<string, number>) {
  for (const [id, count] of Object.entries(counts)) await expect(page.getByTestId(id)).toHaveCount(count);
}
export async function openCase(s: Session, n: number, citizen = false) {
  const response = await s.page.goto(`/${citizen ? 'citizen' : 'officer'}/cases/${caseNo(n)}`);
  expect(response?.status()).toBe(200);
  await text(s.page, 'case-no', caseNo(n));
}
export async function caseAction(s: Session, n: number, action: string, data?: unknown) {
  const prefix = ['claim', 'return', 'forward', 'issue', 'unmask'].includes(action) ? 'officer/' : '';
  return post(s, `/api/${prefix}cases/${caseNo(n)}/${action}`, data);
}
export async function returnUI(s: Session, n: number, reason = 'xxxxxxxxxx') {
  await openCase(s, n);
  await s.page.getByTestId('return-btn').click();
  await s.page.getByTestId('return-reason').fill(reason);
  await s.page.getByTestId('return-submit').click();
}
export async function rejectUI(s: Session, n: number, reason = 'xxxxxxxxxx') {
  await openCase(s, n);
  await s.page.getByTestId('reject-btn').click();
  await s.page.getByTestId('reject-reason').fill(reason);
  await s.page.getByTestId('reject-submit').click();
}
export async function auditFilter(s: Session, filters: { actor?: string; event?: string; from?: string; to?: string } = {}) {
  await s.page.goto('/audit');
  await s.page.getByTestId('audit-filter-actor').fill(filters.actor ?? '');
  await s.page.getByTestId('audit-filter-event').selectOption(filters.event ?? '');
  await s.page.getByTestId('audit-filter-from').fill(filters.from ?? '');
  await s.page.getByTestId('audit-filter-to').fill(filters.to ?? '');
  await s.page.getByTestId('audit-apply-btn').click();
}
export async function download(page: Page, id: string): Promise<{ download: Download; bytes: Buffer }> {
  const pending = page.waitForEvent('download');
  await page.getByTestId(id).click();
  const d = await pending;
  expect(await d.failure()).toBeNull();
  const stream = await d.createReadStream();
  if (!stream) throw new Error(`No download stream for ${id}`);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return { download: d, bytes: Buffer.concat(chunks) };
}
export function noPersonalData(value: string) {
  expect(value).not.toMatch(/\d{13}|0\d{9}/);
  for (const name of ['สมชาย', 'สมหญิง', 'ปิติ', 'มานะ']) expect(value).not.toContain(name);
}
export function noIdKeys(value: unknown) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    expect(key).not.toBe('idNo');
    noIdKeys(child);
  }
}
export const pdfFile = (name = 'id-card.pdf') => {
  const head = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n');
  const tail = Buffer.from('\ntrailer<</Root 1 0 R>>\n%%EOF\n');
  return { name, mimeType: 'application/pdf', buffer: Buffer.concat([head, Buffer.alloc(1024 - head.length - tail.length, 32), tail]) };
};

export class App {
  readonly sessions = new Map<string, Session>();
  private control!: APIRequestContext;
  constructor(readonly browser: Browser, readonly baseURL: string, readonly info: TestInfo) {}
  async init() {
    this.control = await request.newContext({ baseURL: this.baseURL });
    await this.reset();
  }
  async reset() {
    // Every RESET invalidates ALL server sessions. Never reuse an old context afterward.
    // Wait until every open page is quiet first: a request still in flight could reach the server after the reset
    // and create notifications at the reset clock (race seen in Lab 5, TC-NOTI-02 under B03,B07).
    await Promise.all([...this.sessions.values()].map(s =>
      Promise.all(s.context.pages().map(p => p.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})))));
    for (const s of this.sessions.values()) await s.context.close();
    this.sessions.clear();
    expect(await json(await this.control.post('/api/test/reset'))).toEqual({ ok: true, now: NOW });
  }
  async clock(now: string) {
    expect(await json(await this.control.put('/api/test/clock', { data: { now } }))).toEqual({ now });
  }
  async raw() { return this.control; }
  async session(key = 'anon', fresh = false): Promise<Session> {
    if (fresh && this.sessions.has(key)) {
      await this.sessions.get(key)!.context.close();
      this.sessions.delete(key);
    }
    if (!this.sessions.has(key)) {
      const context = await this.browser.newContext({ baseURL: this.baseURL, acceptDownloads: true, ...videoOpts() });
      this.sessions.set(key, { context, page: await context.newPage(), api: context.request });
    }
    return this.sessions.get(key)!;
  }
  async staff(username: string, fresh = false) {
    const key = `staff:${username}`;
    const existing = this.sessions.has(key) && !fresh;
    const s = await this.session(key, fresh);
    if (!existing) await post(s, '/api/auth/staff/login', { username, password: 'Test@1234' });
    return s;
  }
  async citizen(idNo = SOMCHAI, fresh = false) {
    const key = `citizen:${idNo}`;
    const existing = this.sessions.has(key) && !fresh;
    const s = await this.session(key, fresh);
    if (!existing) {
      expect(await post(s, '/api/auth/thaid/start', { idNo })).toEqual({ status: 'OTP_SENT' });
      const result = await post(s, '/api/auth/thaid/verify', { idNo, otp: '123456' });
      expect(result.registered).toBe(idNo !== MANA);
    }
    return s;
  }
  async newPaid(options: { idNo?: string; serviceId?: string; qty?: number; areaSqm?: number; now?: string; fee?: number } = {}) {
    if (options.now) await this.clock(options.now);
    const s = await this.citizen(options.idNo);
    const serviceId = options.serviceId ?? 'SV-01';
    const data = serviceId === 'SV-01' ? { serviceId, qty: options.qty ?? 1 }
      : serviceId === 'SV-03' ? { serviceId, areaSqm: options.areaSqm ?? 101 } : { serviceId };
    const draft = await post(s, '/api/drafts', data, 201);
    const fee = options.fee ?? (serviceId === 'SV-01' ? 20 * (options.qty ?? 1) : serviceId === 'SV-02' ? 500 : 1010);
    expect(draft.fee).toBe(fee);
    const keys = serviceId === 'SV-01' ? ['id-card'] : serviceId === 'SV-02' ? ['id-card', 'map'] : ['id-card', 'plan', 'deed'];
    for (const docKey of keys) {
      await json(await s.api.post(`/api/drafts/${draft.draftId}/files`, { multipart: { docKey, file: pdfFile(`${docKey}.pdf`) } }), 201);
    }
    const payment = await post(s, `/api/drafts/${draft.draftId}/payment`, undefined, 201);
    expect(payment.amount).toBe(fee);
    const paid = await json(await this.control.post(`/api/test/payments/${payment.ref}/pay`, { data: { amount: fee } }));
    expect(paid.status).toBe('PAID');
    expect((await get(s, `/api/payments/${payment.ref}`)).caseNo).toBe(paid.caseNo);
    return { s, draft, payment, paid };
  }
  async dispose() {
    for (const s of this.sessions.values()) await s.context.close();
    await this.control?.dispose();
  }
}
export const test = base.extend<{ app: App }>({
  app: async ({ browser, baseURL }, use, info) => {
    info.setTimeout(180_000);
    const app = new App(browser, process.env.BASE_URL ?? baseURL ?? 'http://127.0.0.1:3000', info);
    try { await app.init(); await use(app); } finally { await app.dispose(); }
  },
});
export { expect };

// Reach focus using Tab only. No programmatic focus or pointer activation.
export async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 150; i++) {
    if (await target.evaluate(el => el === document.activeElement)) {
      const visibleFocus = await target.evaluate(el => {
        const c = getComputedStyle(el);
        return (c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0) || c.boxShadow !== 'none';
      });
      expect(visibleFocus, 'Keyboard focus must have a visible outline or ring').toBe(true);
      return;
    }
    await page.keyboard.press('Tab');
  }
  throw new Error('Could not reach the required control with Tab');
}
export async function keyboardJourney(page: Page) {
  await page.goto('/login');
  await tabTo(page, page.getByTestId('thaid-id-input'));
  await page.keyboard.type(SOMCHAI);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('otp-input')).toBeVisible();
  await tabTo(page, page.getByTestId('otp-input'));
  await page.keyboard.type('123456');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/citizen$/);
  await tabTo(page, page.getByTestId('start-service-SV-01'));
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('qty-input')).toBeVisible();
  await tabTo(page, page.getByTestId('qty-input'));
  await page.keyboard.press('Control+A');
  await page.keyboard.type('1');
  await text(page, 'fee-total', '฿20');
  await tabTo(page, page.getByTestId('to-upload-btn'));
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('upload-input-id-card')).toBeVisible();
  await tabTo(page, page.getByTestId('upload-input-id-card'));
  await page.getByTestId('upload-input-id-card').setInputFiles(pdfFile());
  await expect(page.getByTestId('to-payment-btn')).toBeEnabled();
  await tabTo(page, page.getByTestId('to-payment-btn'));
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('create-qr-btn')).toBeVisible();
}
export async function checkStatusLabels(page: Page) {
  for (const forcedColors of ['none', 'active'] as const) {
    await page.emulateMedia({ forcedColors });
    for (const id of ['case-status', 'row-status', 'sla-level', 'row-sla-level']) {
      for (const el of await page.getByTestId(id).all()) {
        await expect(el).toBeVisible();
        const isStatus = id.includes('status');
        const code = await el.getAttribute(isStatus ? 'data-status' : 'data-level');
        expect(code, `${id} needs a machine-readable code`).toBeTruthy();
        const expected = (isStatus ? statusText : levelText)[code!];
        expect(expected, `Unknown ${id}: ${code}`).toBeTruthy();
        await expect(el).toHaveText(expected);
      }
    }
  }
  await page.emulateMedia({ forcedColors: 'none' });
}
export async function inspectStorage(dbPath: string, extraPaths: string[]) {
  const files: string[] = [];
  async function collect(path: string) {
    const entry = await stat(path);
    if (entry.isDirectory()) {
      for (const item of await readdir(path)) await collect(resolve(path, item));
    } else if (entry.isFile()) files.push(path);
  }
  await collect(resolve(dbPath));
  // SQLite WAL/rollback pages may still contain plaintext even when the main DB does not.
  const dbName = resolve(dbPath);
  for (const name of await readdir(dirname(dbName))) {
    if (name.startsWith(`${dbName.slice(dbName.lastIndexOf('/') + 1)}-`)) await collect(resolve(dirname(dbName), name));
  }
  for (const path of extraPaths) await collect(resolve(path));
  const forbidden = [SOMCHAI, SOMYING, '1909900555015', MANA,
    '0812345678', '0823456789', '0834567890', '0845678901',
    '1-1017-00123-45-6', '3-1006-00987-65-9', '1-9099-00555-01-5', '5-5004-00111-22-1'];
  for (const path of [...new Set(files)]) {
    const bytes = await readFile(path);
    for (const value of forbidden) {
      expect(bytes.includes(Buffer.from(value)), `Plaintext personal data in ${path}: ${value}`).toBe(false);
      expect(bytes.includes(Buffer.from(value, 'utf16le')), `UTF-16 plaintext personal data in ${path}: ${value}`).toBe(false);
    }
  }
  return [...new Set(files)];
}
