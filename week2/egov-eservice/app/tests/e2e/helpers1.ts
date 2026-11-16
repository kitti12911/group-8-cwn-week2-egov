import {
  test as base, expect, request,
  type APIRequestContext, type APIResponse, type Browser, type BrowserContext, type Page,
} from '@playwright/test';
import { deflateSync } from 'node:zlib';

export { expect };
export const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
export const INITIAL_NOW = '2026-12-01T09:00:00+07:00';
export const CITIZENS = {
  somchai: '1101700123456', somying: '3100600987659',
  mana: '5500400111221', piti: '1909900555015',
} as const;
export const caseNo = (n: number) => `EG-2569-${String(n).padStart(6, '0')}`;
export const row = (page: Page, n: number) => page.locator(`[data-testid="queue-row"][data-case-no="${caseNo(n)}"]`);
export const fileItem = (page: Page, name: string) => page.locator(`[data-testid="file-item"][data-name="${name}"]`);

export async function json(response: Pick<APIResponse, 'status' | 'url' | 'text' | 'json'>, status = 200) {
  expect(response.status(), `${response.url()}: ${await response.text()}`).toBe(status);
  return response.json();
}
export async function error(response: APIResponse, status: number, code: string, message?: string) {
  const body = await json(response, status);
  expect(body.code).toBe(code);
  if (message !== undefined) expect(body.message).toBe(message);
  return body;
}

// Byte-exact fixtures follow TEST-DATA §11; no application source or response is an oracle.
function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const name = Buffer.from(type); const len = Buffer.alloc(4); const crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([len, name, data, crc]);
}
export function testFile(name: string, size = 1024) {
  let buffer: Buffer;
  let mimeType = 'application/pdf';
  if (name.startsWith('fake-text') || name === 'notes.txt') {
    buffer = Buffer.from('hello');
    mimeType = name.endsWith('.jpg') ? 'image/jpeg' : name.endsWith('.txt') ? 'text/plain' : 'application/pdf';
  } else if (name === 'exe-as.png') {
    buffer = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(1022)]); mimeType = 'image/png';
  } else if (name.endsWith('.jpg')) {
    mimeType = 'image/jpeg';
    const head = Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex');
    const pad = size - head.length - 6;
    const comment = Buffer.alloc(4); comment.writeUInt16BE(0xfffe); comment.writeUInt16BE(pad + 2, 2);
    buffer = Buffer.concat([head, comment, Buffer.alloc(pad, 'x'), Buffer.from('ffd9', 'hex')]);
  } else if (name.endsWith('.png')) {
    mimeType = 'image/png';
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
    const signature = Buffer.from('89504e470d0a1a0a', 'hex');
    const header = chunk('IHDR', ihdr); const data = chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0])));
    const end = chunk('IEND', Buffer.alloc(0));
    const padding = size - signature.length - header.length - data.length - end.length - 12;
    buffer = Buffer.concat([signature, header, data, chunk('tEXt', Buffer.concat([Buffer.from('k\0'), Buffer.alloc(padding - 2, 'x')])), end]);
  } else {
    const head = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n');
    const tail = Buffer.from('\ntrailer<</Root 1 0 R>>\n%%EOF\n');
    buffer = Buffer.concat([head, Buffer.alloc(size - head.length - tail.length, ' '), tail]);
  }
  return { name, mimeType, buffer };
}

export type Session = { context: BrowserContext; page: Page; api: APIRequestContext };
export class Harness {
  private contexts: BrowserContext[] = [];
  constructor(private browser: Browser) {}
  async close() {
    await Promise.all(this.contexts.map(context => context.close())); this.contexts = [];
  }
  async reset() {
    // Dispose all old cookies, including every context made during a multi-user race.
    await this.close();
    const api = await request.newContext({ baseURL: BASE_URL });
    try {
      expect(await json(await api.post('/api/test/reset'))).toEqual({ ok: true, now: INITIAL_NOW });
    } finally { await api.dispose(); }
  }
  async clock(now: string) {
    const api = await request.newContext({ baseURL: BASE_URL });
    try { expect((await json(await api.put('/api/test/clock', { data: { now } }))).now).toBe(now); }
    finally { await api.dispose(); }
  }
  async anonymous(): Promise<Session> {
    const context = await this.browser.newContext({ baseURL: BASE_URL }); this.contexts.push(context);
    return { context, page: await context.newPage(), api: context.request };
  }
  async citizen(idNo: string = CITIZENS.somchai) {
    const session = await this.anonymous();
    expect(await json(await session.api.post('/api/auth/thaid/start', { data: { idNo } }))).toEqual({ status: 'OTP_SENT' });
    const body = await json(await session.api.post('/api/auth/thaid/verify', { data: { idNo, otp: '123456' } }));
    expect(body.registered).toBe(idNo !== CITIZENS.mana);
    return session;
  }
  async staff(username: string) {
    const session = await this.anonymous();
    await json(await session.api.post('/api/auth/staff/login', { data: { username, password: 'Test@1234' } }));
    return session;
  }
}
export const test = base.extend<{ h: Harness }>({
  h: async ({ browser }, use) => {
    const h = new Harness(browser);
    await h.reset();
    try { await use(h); } finally { await h.close(); }
  },
});

export async function createDraft(api: APIRequestContext, serviceId = 'SV-01', options: { qty?: number; areaSqm?: number } = {}) {
  const data = { serviceId, ...(serviceId === 'SV-01' ? { qty: 1 } : serviceId === 'SV-03' ? { areaSqm: 100 } : {}), ...options };
  return json(await api.post('/api/drafts', { data }), 201);
}
export async function upload(api: APIRequestContext, draftId: string, docKey: string, name: string, size = 1024) {
  return api.post(`/api/drafts/${draftId}/files`, { multipart: { docKey, file: testFile(name, size) } });
}
export async function readyPayment(api: APIRequestContext, serviceId = 'SV-01', options: { qty?: number; areaSqm?: number } = {}) {
  const draft = await createDraft(api, serviceId, options);
  const keys = serviceId === 'SV-01' ? ['id-card'] : serviceId === 'SV-02' ? ['id-card', 'map'] : ['id-card', 'plan', 'deed'];
  for (const key of keys) await json(await upload(api, draft.draftId, key, `${key}.pdf`), 201);
  const payment = await json(await api.post(`/api/drafts/${draft.draftId}/payment`), 201);
  expect(payment.amount).toBe(draft.fee);
  return { ...draft, ...payment };
}
export async function pay(api: APIRequestContext, ref: string, amount: number) {
  return api.post(`/api/test/payments/${ref}/pay`, { data: { amount } });
}
export async function newPaid(h: Harness, serviceId = 'SV-01', now = INITIAL_NOW, options: { qty?: number; areaSqm?: number } = {}) {
  await h.clock(now);
  const session = await h.citizen();
  const payment = await readyPayment(session.api, serviceId, options);
  const paid = await json(await pay(session.api, payment.ref, payment.fee));
  const polled = await json(await session.api.get(`/api/payments/${payment.ref}`));
  expect(polled.caseNo).toBe(paid.caseNo);
  return { ...session, payment, paid };
}
export async function openUpload(session: Session, serviceId = 'SV-01', value = '1') {
  const options = serviceId === 'SV-01' ? { qty: Number(value) } : serviceId === 'SV-03' ? { areaSqm: Number(value) } : {};
  const draft = await createDraft(session.api, serviceId, options);
  await session.page.goto(`/citizen/new/${serviceId}?draft=${draft.draftId}`);
  await session.page.getByTestId('to-upload-btn').click();
  await expect(session.page.getByTestId('wizard-step')).toHaveText('2/3 แนบเอกสาร');
  return draft.draftId as string;
}
export async function uiUpload(page: Page, key: string, name: string, status = 201, size = 1024) {
  // A client may reject invalid bytes before sending HTTP; assert UI and API independently.
  await page.getByTestId(`upload-input-${key}`).setInputFiles(testFile(name, size));
  if (status === 201) await expect(fileItem(page, name)).toHaveCount(1);
  else await expect(page.getByTestId('upload-error')).toBeVisible();
}
export async function removeFile(page: Page, name: string) {
  await fileItem(page, name).getByTestId('file-remove-btn').click();
  await expect(fileItem(page, name)).toHaveCount(0);
}
export async function getCase(api: APIRequestContext, n: number) { return json(await api.get(`/api/cases/${caseNo(n)}`)); }
export async function claim(api: APIRequestContext, n: number) { return api.post(`/api/officer/cases/${caseNo(n)}/claim`); }
export async function assertClaimAudit(h: Harness, n: number) {
  const auditor = await h.staff('audit1');
  const audit = await json(await auditor.api.get('/api/audit?event=CLAIM'));
  expect(audit.items.filter((item: { caseNo: string; event: string }) => item.caseNo === caseNo(n) && item.event === 'CLAIM')).toHaveLength(1);
}
export async function assertLevel(session: Session, n: number, text: string, level: string, officer = false) {
  await session.page.goto(`/${officer ? 'officer' : 'citizen'}/cases/${caseNo(n)}`);
  await expect(session.page.getByTestId('sla-level')).toHaveText(text);
  await expect(session.page.getByTestId('sla-level')).toHaveAttribute('data-level', level);
  expect((await getCase(session.api, n)).slaLevel).toBe(level);
}
