// B04 · /login (ThaiD mock + staff SSO mock) and /register client logic
(function () {
  const $ = (id) => document.getElementById(id);
  const show = (el, text) => { if (!el) return; if (text !== undefined) el.textContent = text; el.hidden = false; };
  const hide = (el) => { if (el) el.hidden = true; };
  const api = (m, u, b) => window.egov.api(m, u, b);
  const MSG = {
    INVALID_ID: 'เลขบัตรประชาชนไม่ถูกต้อง',
    OTP_INVALID: 'รหัส OTP ไม่ถูกต้อง',
    INVALID_CREDENTIALS: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
    INVALID_MOBILE: 'เบอร์มือถือต้องเป็นตัวเลข 10 หลักขึ้นต้นด้วย 0',
    CONSENT_REQUIRED: 'กรุณายินยอมการประมวลผลข้อมูลส่วนบุคคล (PDPA)',
  };
  // navigate a moment after success so test runners can still read the 200 response body
  const go = (url) => setTimeout(() => window.location.assign(url), 300);
  const msgOf = (r, code) => (r.data && r.data.message) || MSG[code] || 'เกิดข้อผิดพลาด';

  function init() {
    if ($('thaid-form')) initLogin();
    if ($('register-form')) initRegister();
  }

  // ───────────── /login ─────────────
  function initLogin() {
    const tabs = [document.querySelector('[data-testid="login-tab-citizen"]'), document.querySelector('[data-testid="login-tab-staff"]')];
    function select(tab, focus) {
      tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        $(t.getAttribute('aria-controls')).hidden = !on;
      });
      if (focus) tab.focus();
    }
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(t, false));
      t.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); select(tabs[(i + 1) % 2], true); }
      });
    });

    const idInput = $('thaid-id'), thaidErr = $('thaid-error');
    const otpStep = $('otp-step'), otpInput = $('otp'), otpErr = $('otp-error'), otpLeft = $('otp-left');
    const lockBox = $('lock-box'), lockUntil = $('lock-until');
    let idNo = '';

    function showLock(iso) {
      hide(otpErr); hide(otpLeft);
      lockUntil.setAttribute('data-iso', iso || '');
      lockUntil.setAttribute('datetime', iso || '');
      lockUntil.textContent = iso ? iso.slice(11, 16) + ' น.' : '';
      show(lockBox);
    }

    $('thaid-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const value = idInput.value.trim();
      const r = await api('POST', '/api/auth/thaid/start', { idNo: value });
      if (r.ok) {
        idNo = value;
        hide(thaidErr); hide(lockBox); hide(otpErr); hide(otpLeft);
        idInput.removeAttribute('aria-invalid');
        show(otpStep);
        otpInput.value = '';
        otpInput.focus();
        return;
      }
      const code = r.data && r.data.code;
      if (code === 'LOCKED') { hide(thaidErr); hide(otpStep); showLock(r.data.lockedUntil); return; }
      hide(otpStep); hide(lockBox);
      idInput.setAttribute('aria-invalid', 'true');
      show(thaidErr, msgOf(r, 'INVALID_ID'));
    });

    $('otp-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = await api('POST', '/api/auth/thaid/verify', { idNo: idNo || idInput.value.trim(), otp: otpInput.value.trim() });
      if (r.ok) { go((r.data && r.data.landing) || (r.data && r.data.registered ? '/citizen' : '/register')); return; }
      const code = r.data && r.data.code;
      if (code === 'LOCKED') { showLock(r.data.lockedUntil); return; }
      hide(lockBox);
      if (code === 'OTP_INVALID') {
        show(otpErr, msgOf(r, code));
        show(otpLeft, 'เหลือ ' + r.data.attemptsLeft + ' ครั้ง');
        otpInput.setAttribute('aria-invalid', 'true');
        return;
      }
      if (code === 'INVALID_ID') { hide(otpStep); show(thaidErr, msgOf(r, code)); return; }
      show(otpErr, msgOf(r, code));
    });

    $('staff-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const staffErr = $('staff-error');
      const r = await api('POST', '/api/auth/staff/login', { username: $('staff-username').value, password: $('staff-password').value });
      if (r.ok) { go(r.data.landing); return; }
      show(staffErr, msgOf(r, 'INVALID_CREDENTIALS'));
    });
  }

  // ───────────── /register ─────────────
  function initRegister() {
    const mobile = $('reg-mobile'), email = $('reg-email'), consent = $('reg-consent');
    const errMobile = $('reg-error-mobile'), errConsent = $('reg-error-consent');
    $('register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      hide(errMobile); hide(errConsent);
      mobile.removeAttribute('aria-invalid'); consent.removeAttribute('aria-invalid');
      let bad = false;
      if (!/^0\d{9}$/.test(mobile.value.trim())) { show(errMobile, MSG.INVALID_MOBILE); mobile.setAttribute('aria-invalid', 'true'); bad = true; }
      if (!consent.checked) { show(errConsent, MSG.CONSENT_REQUIRED); consent.setAttribute('aria-invalid', 'true'); bad = true; }
      if (bad) return;
      const r = await api('POST', '/api/auth/register', { mobile: mobile.value.trim(), email: email.value.trim(), consent: consent.checked });
      if (r.ok) { go((r.data && r.data.landing) || '/citizen'); return; }
      const code = r.data && r.data.code;
      if (code === 'INVALID_MOBILE') show(errMobile, msgOf(r, code));
      else if (code === 'CONSENT_REQUIRED') show(errConsent, msgOf(r, code));
      else if (code === 'UNAUTHENTICATED') window.location.assign('/login');
      else window.egov.showError(msgOf(r, code));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
