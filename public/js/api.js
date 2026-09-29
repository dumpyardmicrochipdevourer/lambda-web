const RT_KEY = 'lambda.rt';
const EARLY_REFRESH_MS = 30000;

let access = null;
let accessUntil = 0;
let refreshing = null;

export class HttpError extends Error {
  constructor(status, detail, headers = {}) {
    super(detail || ('HTTP ' + status));
    this.status = status;
    this.headers = headers;
  }
}

export class SessionExpired extends Error {}

function readRt() {
  try { return localStorage.getItem(RT_KEY); } catch (e) { return null; }
}

function writeRt(value) {
  try {
    if (value) localStorage.setItem(RT_KEY, value);
    else localStorage.removeItem(RT_KEY);
  } catch (e) { /* storage may be blocked, the session then lives until reload */ }
}

function accept(tokens) {
  access = tokens.accessToken;
  accessUntil = Date.now() + tokens.expiresIn * 1000;
  writeRt(tokens.refreshToken);
}

export function forget() {
  access = null;
  accessUntil = 0;
  writeRt(null);
}

export function hasSession() {
  return !!readRt();
}

async function errorOf(r) {
  let detail = '';
  try {
    const body = await r.json();
    detail = body.detail || body.title || '';
  } catch (e) { /* not json */ }
  return new HttpError(r.status, detail);
}

// refresh tokens are single use and reusing one revokes every session,
// so two tabs must never refresh at the same time
function exclusive(fn) {
  return navigator.locks ? navigator.locks.request('lambda-refresh', fn) : fn();
}

export function refresh() {
  if (!refreshing) {
    refreshing = exclusive(async () => {
      const rt = readRt();
      if (!rt) throw new SessionExpired();
      const r = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: rt })
      });
      if (r.status === 401) { forget(); throw new SessionExpired(); }
      if (!r.ok) throw await errorOf(r);
      accept(await r.json());
    }).finally(() => { refreshing = null; });
  }
  return refreshing;
}

export async function token() {
  if (!access || Date.now() > accessUntil - EARLY_REFRESH_MS) await refresh();
  return access;
}

export async function api(path, opts = {}) {
  const send = async () => {
    const headers = { 'Accept': 'application/json' };
    let body;
    if (opts.auth) headers.Authorization = 'Bearer ' + await token();
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.json);
    }
    return fetch(path, { method: opts.method || 'GET', headers, body });
  };
  let r = await send();
  if (r.status === 401 && opts.auth && opts.retry !== false) {
    await refresh();
    r = await send();
  }
  if (!r.ok) throw await errorOf(r);
  if (r.status === 204) return null;
  const type = r.headers.get('Content-Type') || '';
  return type.includes('json') ? r.json() : r;
}

export async function login(username, password) {
  accept(await api('/api/auth/login', { method: 'POST', json: { username, password } }));
}

export async function register(inviteCode, username, password) {
  accept(await api('/api/auth/register', { method: 'POST', json: { inviteCode, username, password } }));
}

export async function changePassword(currentPassword, newPassword) {
  accept(await api('/api/auth/password', {
    method: 'POST', auth: true, retry: false, json: { currentPassword, newPassword }
  }));
}

export async function logout() {
  const rt = readRt();
  forget();
  if (rt) {
    try { await api('/api/auth/logout', { method: 'POST', json: { refreshToken: rt } }); } catch (e) { /* already gone */ }
  }
}

// XHR instead of fetch: only XHR reports upload progress
export function put(url, body, { headers = {}, auth = false, onProgress, onXhr } = {}) {
  const once = (bearer) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    if (bearer) xhr.setRequestHeader('Authorization', 'Bearer ' + bearer);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded); };
    xhr.onload = () => {
      let json = null;
      try { json = JSON.parse(xhr.responseText); } catch (e) { /* empty */ }
      if (xhr.status >= 200 && xhr.status < 300) { resolve(json); return; }
      const offset = xhr.getResponseHeader('Upload-Offset');
      reject(new HttpError(xhr.status, json && json.detail, offset != null ? { 'upload-offset': offset } : {}));
    };
    xhr.onerror = () => reject(new HttpError(0, ''));
    xhr.onabort = () => { const e = new HttpError(0, ''); e.aborted = true; reject(e); };
    if (onXhr) onXhr(xhr);
    xhr.send(body);
  });
  if (!auth) return once(null);
  return token().then(once).catch(async (e) => {
    if (e.status !== 401) throw e;
    await refresh();
    return once(access);
  });
}
