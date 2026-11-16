// Shared client helpers: egov.api(method, url, body) → {ok,status,data}; egov.showError(msg, testid); egov.showSuccess(msg)
(function () {
  async function api(method, url, body) {
    const opt = { method, headers: {}, credentials: 'same-origin' };
    if (body instanceof FormData) opt.body = body;
    else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const r = await fetch(url, opt);
    let data = null;
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('application/json')) data = await r.json();
    return { ok: r.ok, status: r.status, data };
  }
  function box(testid, cls) {
    let el = document.querySelector('[data-testid="' + testid + '"]');
    if (!el) {
      el = document.createElement('div');
      el.setAttribute('data-testid', testid);
      el.className = cls;
      (document.querySelector('main') || document.body).prepend(el);
    }
    return el;
  }
  function showError(msg, testid) {
    const el = box(testid || 'action-error', 'alert alert-error');
    el.setAttribute('role', 'alert');
    el.textContent = msg;
    el.hidden = false;
    return el;
  }
  function showSuccess(msg) {
    const el = box('action-success', 'alert alert-success');
    el.setAttribute('role', 'status');
    el.textContent = msg;
    el.hidden = false;
    return el;
  }
  window.egov = { api, showError, showSuccess };
})();
