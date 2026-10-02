import { L, t, pl, unit, getLang, setLangValue, pickLang } from './i18n.js';
import { qrSvg } from './qr.js';
import * as API from './api.js';

const CFG = {
  codeLength: 6,
  ttls: [900, 3600, 86400],
  ttlDefault: 86400,
  maxBytes: 2147483648,
  textName: 'message.txt',
  textMax: 65536,
  fbMax: 8000
};

const $ = (id) => document.getElementById(id);
const SCREENS = ['s-idle', 's-upload', 's-ready', 's-recv', 's-err', 's-login', 's-register',
  's-account', 's-files', 's-admin'];

let REPAINT = null;
let ME = null;
let STORE = { quota: 0, used: 0, reserved: 0, files: [], confirm: null };
let current = { aborted: false, xhr: null };

/* ------------------------------------------------------------ language */

function applyLang() {
  document.documentElement.lang = getLang();
  const name = document.title;
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  document.querySelectorAll('[data-t-ph]').forEach((el) => { el.placeholder = t(el.dataset.tPh); });
  document.querySelectorAll('[data-t-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.tAria, name)); });
  document.querySelectorAll('[data-lang]').forEach((b) => { b.setAttribute('aria-pressed', String(b.dataset.lang === getLang())); });
  paintTtls();
  if (REPAINT) { const r = REPAINT; r(); REPAINT = r; }
}

function setLang(l) {
  if (!L[l]) return;
  setLangValue(l);
  try { localStorage.setItem('lambda.lang', l); } catch (e) { /* ignore */ }
  applyLang();
}

/* ------------------------------------------------------------ helpers */

function size(b) {
  const en = getLang() === 'en';
  const U = en ? ['B', 'KB', 'MB', 'GB', 'TB'] : ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  if (b < 1024) return b + ' ' + U[0];
  let i = 0, v = b;
  do { v /= 1024; i++; } while (v >= 1024 && i < U.length - 1);
  let s = v < 100 ? v.toFixed(1) : String(Math.round(v));
  if (s.endsWith('.0')) s = s.slice(0, -2);
  return (en ? s : s.replace('.', ',')) + ' ' + U[i];
}

function clock(d) {
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function dayDiff(a, b) {
  return Math.round((new Date(a.getFullYear(), a.getMonth(), a.getDate()) -
                     new Date(b.getFullYear(), b.getMonth(), b.getDate())) / 86400000);
}

function shortDate(d) {
  return d.toLocaleDateString(getLang() === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'short' });
}

function expiryText(end) {
  const now = new Date();
  if (end <= now) return t('exp_gone');
  const days = dayDiff(end, now);
  if (days <= 0) return t('exp_at', clock(end));
  if (days === 1) return t('exp_tmr', clock(end));
  return t('exp_date', shortDate(end), clock(end));
}

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso), now = new Date();
  const days = dayDiff(now, d);
  if (days === 0) return t('today', clock(d));
  if (days === 1) return t('yday', clock(d));
  return shortDate(d) + (d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : '');
}

function emsg(e) {
  if (!e) return '';
  if (e.status === 0) return t(e.aborted ? 'e_abort' : 'e_net');
  if (e.status === 429) return t('too_often');
  return e.message || ('HTTP ' + e.status);
}

function copyText(text, button, label) {
  const ok = () => {
    button.textContent = t('copied');
    setTimeout(() => { button.textContent = t(label); }, 1600);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(ok, () => {});
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); ok(); } catch (e) { /* ignore */ }
  document.body.removeChild(ta);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function item(title, sub, cls) {
  const row = el('div', 'item' + (cls ? ' ' + cls : ''));
  const nm = el('div', 'nm');
  nm.append(el('b', null, title), el('span', null, sub));
  row.append(nm);
  return row;
}

const ICON_DL = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke-width="1.7" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/></svg>';
const ICON_RM = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke-width="1.7" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 7h16"/><path d="M9 7V4h6v3"/>' +
  '<path d="M6 7l.9 12.1A1 1 0 0 0 7.9 20h8.2a1 1 0 0 0 1-.9L18 7"/>' +
  '<path d="M10 11v5"/><path d="M14 11v5"/></svg>';

function show(id) {
  REPAINT = null;
  SCREENS.forEach((s) => { $(s).hidden = s !== id; });
  $('card').classList.toggle('wide', id === 's-files' || id === 's-admin');
  paintTop();
}

function fail(title, text, label, big) {
  $('err-title').textContent = title;
  $('err-title').className = big ? 'bad' : '';
  $('err-text').textContent = text;
  $('err-act').textContent = label || t('retry');
  $('err-act').onclick = () => { if (location.hash) location.hash = ''; else idle(); };
  $('err-act2').hidden = true;
  show('s-err');
}

function failT(fn) {
  const r = () => fail(...fn());
  r();
  REPAINT = r;
}

function expired() {
  ME = null;
  API.forget();
  const r = () => {
    $('err-title').textContent = t('sess_t');
    $('err-title').className = '';
    $('err-text').textContent = t('sess');
    $('err-act').textContent = t('relogin');
    $('err-act').onclick = () => { location.hash = 'login'; };
    $('err-act2').hidden = true;
  };
  show('s-err');
  r();
  REPAINT = r;
}

// one place that turns errors into screens; returns true if handled as a lost session
function lostSession(e) {
  if (e instanceof API.SessionExpired) { expired(); return true; }
  return false;
}

/* ------------------------------------------------------------ top bar */

function paintTop() {
  const on = !!ME;
  $('top').hidden = !on;
  $('mark').hidden = on;
  $('foot-my').hidden = on;
  if (!on) return;
  $('who-name').textContent = ME.username;
  $('nav-a').hidden = ME.role !== 'ADMIN';
  const mine = !$('s-files').hidden || !$('s-account').hidden;
  const admin = !$('s-admin').hidden;
  $('nav-f').className = mine ? 'on' : '';
  $('nav-a').className = admin ? 'on' : '';
  $('nav-x').className = mine || admin ? '' : 'on';
}

/* ------------------------------------------------------------ swap: home */

function idle() {
  $('code').value = '';
  $('code').classList.remove('bad');
  setTab(false);
  paintTtls();
  show('s-idle');
}

function setTab(text) {
  $('tab-file').classList.toggle('on', !text);
  $('tab-text').classList.toggle('on', text);
  $('tab-file').setAttribute('aria-pressed', String(!text));
  $('tab-text').setAttribute('aria-pressed', String(text));
  $('zone').hidden = text;
  $('msg').hidden = !text;
  $('send-text').hidden = !text;
  if (!text) $('msg').value = '';
}

function ttlLabel(sec) {
  if (sec % 86400 === 0) return unit(sec / 86400, 'day');
  if (sec % 3600 === 0) return unit(sec / 3600, 'hour');
  return unit(Math.round(sec / 60), 'min');
}

let TTL = null;
function pickedTtl() {
  if (TTL) return TTL;
  let s = 0;
  try { s = parseInt(localStorage.getItem('lambda.ttl'), 10) || 0; } catch (e) { /* ignore */ }
  TTL = CFG.ttls.includes(s) ? s : CFG.ttlDefault;
  return TTL;
}

function paintTtls() {
  const box = $('ttls'), cur = pickedTtl();
  box.innerHTML = '';
  CFG.ttls.forEach((sec) => {
    const b = el('button', sec === cur ? 'on' : '', ttlLabel(sec));
    b.type = 'button';
    b.setAttribute('aria-pressed', String(sec === cur));
    b.onclick = () => {
      TTL = sec;
      try { localStorage.setItem('lambda.ttl', String(sec)); } catch (e) { /* ignore */ }
      paintTtls();
    };
    box.append(b);
  });
}

function asFile(text) {
  return new File([text], CFG.textName, { type: 'text/plain;charset=utf-8' });
}

/* ------------------------------------------------------------ upload screen */

function progressScreen(files) {
  const total = files.reduce((a, f) => a + f.size, 0);
  const started = Date.now();
  let base = 0;
  $('queue').innerHTML = '';
  const rows = files.map((f) => {
    const row = item(f.name, size(f.size));
    row.append(el('span', 'st', t('queued')));
    $('queue').append(row);
    return row;
  });
  const paint = (loaded) => {
    const done = base + loaded;
    const pct = total ? Math.min(100, Math.round(done * 100 / total)) : 100;
    $('pct').textContent = pct + '%';
    $('bar').style.width = pct + '%';
    $('done').textContent = t('of', size(done), size(total));
    const sec = (Date.now() - started) / 1000;
    if (sec > 0.7 && done > 0) {
      const rate = done / sec;
      $('speed').textContent = t('per_s', size(Math.round(rate)));
      const left = Math.max(0, Math.round((total - done) / rate));
      $('eta').textContent = left > 0 ? t('left_s', pl(left, 'sec')) : '';
    }
  };
  $('speed').textContent = '—';
  $('eta').textContent = '';
  show('s-upload');
  paint(0);
  return {
    total,
    file(i, loaded) {
      const f = files[i];
      rows[i].querySelector('.st').textContent = (f.size ? Math.min(100, Math.round(loaded * 100 / f.size)) : 100) + '%';
      paint(loaded);
    },
    done(i) {
      base += files[i].size;
      rows[i].querySelector('.st').textContent = t('done');
      paint(0);
    }
  };
}

function startUpload() {
  current = { aborted: false, xhr: null };
  return current;
}

$('cancel').onclick = () => {
  current.aborted = true;
  if (current.xhr) { try { current.xhr.abort(); } catch (e) { /* ignore */ } }
};

/* ------------------------------------------------------------ swap: send */

// core refuses names that would need %, ; or slashes in the path
function shareName(name, taken) {
  let n = name.replace(/[%;\\/]/g, '_').replace(/[\u0000-\u001f]/g, '');
  if (!n || n === '.' || n === '..') n = 'file';
  const lower = (s) => s.toLowerCase();
  if (!taken.has(lower(n))) { taken.add(lower(n)); return n; }
  const dot = n.lastIndexOf('.');
  const stem = dot > 0 ? n.slice(0, dot) : n;
  const ext = dot > 0 ? n.slice(dot) : '';
  for (let i = 1; ; i++) {
    const c = stem + ' (' + i + ')' + ext;
    if (!taken.has(lower(c))) { taken.add(lower(c)); return c; }
  }
}

async function sendSwap(list) {
  const files = Array.from(list);
  if (!files.length) return;
  const tooBig = files.find((f) => f.size > CFG.maxBytes);
  if (tooBig) {
    failT(() => [t('big_t'), t('big', size(CFG.maxBytes), tooBig.name, size(tooBig.size)), t('pick_other'), true]);
    return;
  }
  const ttl = pickedTtl();
  const job = startUpload();
  const ui = progressScreen(files);
  try {
    const share = await API.api('/api/share', { method: 'POST', json: { ttlSeconds: ttl } });
    const taken = new Set();
    for (let i = 0; i < files.length; i++) {
      if (job.aborted) throw Object.assign(new API.HttpError(0, ''), { aborted: true });
      const name = shareName(files[i].name, taken);
      await API.put('/api/share/' + share.code + '/files/' + encodeURIComponent(name), files[i], {
        headers: { 'Content-Type': files[i].type || 'application/octet-stream' },
        onProgress: (l) => ui.file(i, l),
        onXhr: (x) => { job.xhr = x; }
      });
      ui.done(i);
    }
    ready(share.code, files.length, ui.total, new Date(share.expiresAt));
  } catch (e) {
    if (job.aborted) { idle(); return; }
    failT(() => [t('send_fail_t'), t('send_fail', emsg(e)), t('back')]);
  }
}

/* ------------------------------------------------------------ swap: ready */

function ready(code, count, total, expiresAt) {
  const url = location.origin + location.pathname + '#' + code;
  const paint = () => {
    $('out-code').textContent = code;
    $('out-when').textContent = expiryText(expiresAt) + ' · ' + pl(count, 'file') + ', ' + size(total);
    $('out-link').textContent = url.replace(/^https?:\/\//, '');
    try { $('out-qr').innerHTML = qrSvg(url, t('qr_aria')); $('out-qr').hidden = false; }
    catch (e) { $('out-qr').hidden = true; }
  };
  $('out-copy').onclick = () => copyText(url, $('share'), 'copy');
  $('share').onclick = () => {
    if (navigator.share) navigator.share({ url }).catch(() => copyText(url, $('share'), 'copy'));
    else copyText(url, $('share'), 'copy');
  };
  show('s-ready');
  paint();
  REPAINT = paint;
}

/* ------------------------------------------------------------ swap: receive */

function looksLikeNote(files) {
  return files.length === 1 && files[0].name === CFG.textName && files[0].size > 0 && files[0].size <= CFG.textMax;
}

// control characters other than tabs and newlines mean a binary that slipped past the decoder
function isPlainText(s) {
  if (!s.length) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13) continue;
    if (c < 32) return false;
  }
  return true;
}

async function openCode(raw) {
  const code = String(raw || '').trim().toUpperCase();
  if (!code) return;
  $('recv-code').textContent = code;
  $('recv-title').textContent = t('loading');
  $('recv-sub').textContent = '';
  $('recv-list').innerHTML = '';
  $('recv-list').hidden = false;
  $('recv-text').hidden = true;
  $('note-copy').hidden = true;
  show('s-recv');

  let share;
  try {
    share = await API.api('/api/share/' + encodeURIComponent(code));
  } catch (e) {
    if (e.status === 404 || e.status === 400) failT(() => [t('nocode_t'), t('nocode')]);
    else failT(() => [t('noopen_t'), t('server', emsg(e)), t('back')]);
    return;
  }
  const files = share.files;
  if (!files.length) { failT(() => [t('gone_t'), t('gone'), t('send_own')]); return; }
  const base = '/api/share/' + encodeURIComponent(share.code);
  const expiresAt = new Date(share.expiresAt);

  if (looksLikeNote(files)) {
    try {
      const r = await fetch(base + '/files/' + files[0].id);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const txt = new TextDecoder('utf-8', { fatal: true }).decode(await r.arrayBuffer());
      if (!isPlainText(txt)) throw new Error('binary');
      const paint = () => paintNote(base, files[0], txt, expiresAt);
      paint();
      REPAINT = paint;
      return;
    } catch (e) { /* not a note after all, fall through to the file list */ }
  }
  const paint = () => paintFiles(base, files, expiresAt);
  paint();
  REPAINT = paint;
}

function paintNote(base, file, txt, expiresAt) {
  $('recv-title').textContent = t('note_t');
  $('recv-sub').textContent = size(file.size) + ' · ' + pl(txt.split('\n').length, 'line') + ' · ' + expiryText(expiresAt);
  $('recv-text').textContent = txt;
  $('recv-text').hidden = false;
  $('recv-list').hidden = true;
  $('note-copy').hidden = false;
  $('note-copy').textContent = t('copy_text');
  $('note-copy').onclick = () => copyText(txt, $('note-copy'), 'copy_text');
  $('recv-all').href = base + '/files/' + file.id;
  $('recv-all-label').textContent = t('dl_txt');
}

function paintFiles(base, files, expiresAt) {
  const total = files.reduce((a, f) => a + f.size, 0);
  $('recv-text').hidden = true;
  $('note-copy').hidden = true;
  $('recv-list').hidden = false;
  $('recv-list').innerHTML = '';
  $('recv-title').textContent = pl(files.length, 'file');
  $('recv-sub').textContent = size(total) + ' · ' + expiryText(expiresAt);
  files.forEach((f) => {
    const row = item(f.name, size(f.size));
    const a = el('a', 'icon');
    a.innerHTML = ICON_DL;
    a.href = base + '/files/' + f.id;
    a.setAttribute('aria-label', t('dl_aria', f.name));
    row.append(a);
    $('recv-list').append(row);
  });
  if (files.length === 1) {
    $('recv-all').href = base + '/files/' + files[0].id;
    $('recv-all-label').textContent = t('dl_one', size(total));
  } else {
    $('recv-all').href = base + '/archive';
    $('recv-all-label').textContent = t('dl_all', size(total));
  }
}

/* ------------------------------------------------------------ account */

async function loadMe() {
  ME = await API.api('/api/auth/me', { auth: true });
  return ME;
}

function showLogin(errKey) {
  $('l-err').hidden = !errKey;
  if (errKey) $('l-err').textContent = t(errKey);
  $('l-name').classList.toggle('bad', !!errKey);
  $('l-pw').classList.toggle('bad', !!errKey);
  show('s-login');
  if (errKey) REPAINT = () => { $('l-err').textContent = t(errKey); };
}

function showRegister(invite) {
  if (invite) $('r-invite').value = invite;
  $('r-err').hidden = true;
  show('s-register');
}

function showAccount() {
  if (!ME) { showLogin(); return; }
  $('acc-name').textContent = ME.username;
  $('acc-user').value = ME.username;
  $('p-err').hidden = true;
  show('s-account');
}

function formError(box, key) {
  box.textContent = t(key);
  box.hidden = false;
  REPAINT = () => { box.textContent = t(key); };
}

function afterSignIn() {
  if (location.hash === '#files') myFiles(); else location.hash = 'files';
}

$('login-form').onsubmit = async (e) => {
  e.preventDefault();
  const name = $('l-name').value.trim(), pw = $('l-pw').value;
  if (!name || !pw) { showLogin('bad_login'); return; }
  $('l-go').textContent = t('checking');
  try {
    await API.login(name, pw);
    await loadMe();
    $('l-pw').value = '';
    afterSignIn();
  } catch (err) {
    showLogin(err.status === 429 ? 'too_often' : err.status === 401 || err.status === 400 ? 'bad_login' : null);
    if (err.status !== 401 && err.status !== 400 && err.status !== 429) formError($('l-err'), 'e_net');
  } finally {
    $('l-go').textContent = t('signin');
  }
};

$('reg-form').onsubmit = async (e) => {
  e.preventDefault();
  const invite = $('r-invite').value.trim(), name = $('r-name').value.trim(), pw = $('r-pw').value;
  $('r-go').textContent = t('checking');
  try {
    await API.register(invite, name, pw);
    await loadMe();
    $('r-pw').value = '';
    $('r-invite').value = '';
    afterSignIn();
  } catch (err) {
    const key = { 403: 'bad_invite', 409: 'name_taken', 400: 'bad_creds', 429: 'too_often' }[err.status] || 'e_net';
    formError($('r-err'), key);
  } finally {
    $('r-go').textContent = t('reg_go');
  }
};

$('pw-form').onsubmit = async (e) => {
  e.preventDefault();
  $('p-go').textContent = t('checking');
  try {
    await API.changePassword($('p-old').value, $('p-new').value);
    $('p-old').value = '';
    $('p-new').value = '';
    $('p-err').hidden = true;
    $('p-go').textContent = t('pw_changed');
    setTimeout(() => { $('p-go').textContent = t('pw_change'); }, 1600);
    return;
  } catch (err) {
    if (lostSession(err)) return;
    formError($('p-err'), { 401: 'bad_old_pw', 400: 'bad_new_pw' }[err.status] || 'e_net');
  }
  $('p-go').textContent = t('pw_change');
};

$('logout').onclick = async () => {
  ME = null;
  await API.logout();
  if (location.hash) location.hash = ''; else idle();
};

/* ------------------------------------------------------------ my files */

const RESUME_KEY = 'lambda.resume';

function resumeMap() {
  try { return JSON.parse(localStorage.getItem(RESUME_KEY)) || {}; } catch (e) { return {}; }
}

function saveResume(map) {
  try { localStorage.setItem(RESUME_KEY, JSON.stringify(map)); } catch (e) { /* ignore */ }
}

function fileKey(f) {
  return [ME && ME.id, f.name, f.size, f.lastModified || 0].join('|');
}

async function myFiles() {
  if (!ME) { showLogin(); return; }
  STORE.confirm = null;
  show('s-files');
  $('q-used').textContent = t('loading');
  $('q-left').textContent = '';
  try {
    const s = await API.api('/api/files', { auth: true });
    STORE = { quota: s.quota, used: s.used, reserved: s.reserved, files: s.files, confirm: null };
    paintStore();
  } catch (e) {
    if (lostSession(e)) return;
    failT(() => [t('store_fail_t'), t('server', emsg(e)), t('back')]);
  }
}

function paintStore() {
  paintQuota();
  paintMine();
  REPAINT = () => { paintQuota(); paintMine(); };
}

function paintQuota() {
  const q = STORE.quota, u = STORE.used + STORE.reserved;
  const pct = q ? Math.min(100, u * 100 / q) : 0;
  const tight = pct >= 90;
  $('q-used').textContent = t('used', size(u), size(q));
  $('q-left').textContent = t(tight ? 'remain' : 'free', size(Math.max(0, q - u)));
  $('q-left').classList.toggle('warn', tight);
  $('q-bar').style.width = (u ? Math.max(pct, 1.5) : 0) + '%';
  $('q-bar').classList.toggle('bad', tight);
}

function paintMine() {
  const box = $('my-list');
  box.innerHTML = '';
  box.hidden = !STORE.files.length;
  $('my-empty').hidden = !!STORE.files.length;

  STORE.files.forEach((f) => {
    const partial = f.status !== 'COMPLETE';
    if (STORE.confirm === f.id) {
      const row = item(f.name, t('del_q'), 'danger');
      const no = el('button', 'mini', t('del_no'));
      const yes = el('button', 'mini kill', t('del_yes'));
      no.type = yes.type = 'button';
      no.onclick = () => { STORE.confirm = null; paintMine(); };
      yes.onclick = () => { yes.textContent = t('deleting'); removeFile(f); };
      row.append(no, yes);
      box.append(row);
      return;
    }
    const sub = partial
      ? t('partial', size(f.received), size(f.size))
      : size(f.size) + (f.createdAt ? ' · ' + when(f.createdAt) : '');
    const row = item(f.name, sub, partial ? 'dim' : '');
    if (partial) {
      row.querySelector('.nm span').classList.add('warn');
    } else {
      const a = el('a', 'icon');
      a.innerHTML = ICON_DL;
      a.href = '#files';
      a.setAttribute('aria-label', t('dl_aria', f.name));
      a.onclick = (e) => { e.preventDefault(); download(f); };
      row.append(a);
    }
    const rm = el('button', 'icon plain');
    rm.type = 'button';
    rm.innerHTML = ICON_RM;
    rm.setAttribute('aria-label', t('rm_aria', f.name));
    rm.onclick = () => { STORE.confirm = f.id; paintMine(); };
    row.append(rm);
    box.append(row);
  });
}

async function download(f) {
  try {
    const tok = await API.token();
    const a = el('a');
    a.href = '/api/files/' + f.id + '/content?access_token=' + encodeURIComponent(tok);
    a.download = f.name;
    document.body.append(a);
    a.click();
    a.remove();
  } catch (e) {
    if (!lostSession(e)) failT(() => [t('noopen_t'), t('server', emsg(e)), t('back')]);
  }
}

async function removeFile(f) {
  try {
    await API.api('/api/files/' + f.id, { method: 'DELETE', auth: true });
    myFiles();
  } catch (e) {
    if (lostSession(e)) return;
    failT(() => [t('del_fail_t'), t('server', emsg(e)), t('back')]);
  }
}

function noRoom(files, total, free) {
  const paint = () => {
    $('err-title').textContent = t('room_t');
    $('err-title').className = 'bad';
    $('err-text').textContent = (files.length === 1
      ? t('room_1', files[0].name, size(total))
      : t('room_n', pl(files.length, 'file'), size(total))) + t('room_free', size(free));
    $('err-act').textContent = t('free_up');
    $('err-act').onclick = () => { if (location.hash === '#files') myFiles(); else location.hash = 'files'; };
    $('err-act2').hidden = false;
    $('err-act2').textContent = t('via_x');
    $('err-act2').onclick = () => { if (location.hash) location.hash = ''; else idle(); };
  };
  show('s-err');
  paint();
  REPAINT = paint;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// keeps pushing from wherever the server says it stopped; a dropped connection costs only the lost tail
async function pushContent(job, id, file, offset, onProgress) {
  let failures = 0;
  for (;;) {
    if (job.aborted) throw Object.assign(new API.HttpError(0, ''), { aborted: true });
    try {
      const v = await API.put('/api/files/' + id + '/content', file.slice(offset), {
        auth: true,
        headers: { 'Upload-Offset': String(offset) },
        onProgress: (l) => onProgress(offset + l),
        onXhr: (x) => { job.xhr = x; }
      });
      if (v.status === 'COMPLETE') return;
      offset = v.received;
    } catch (e) {
      if (e.aborted || job.aborted) throw e;
      if (e.status === 409 && e.headers['upload-offset'] != null) {
        offset = Number(e.headers['upload-offset']);
        if (++failures > 5) throw e;
        continue;
      }
      if (e.status !== 0 && e.status < 500) throw e;
      if (++failures > 5) throw e;
      await sleep(1000 * failures);
    }
  }
}

async function sendMine(list) {
  const files = Array.from(list);
  if (!files.length) return;
  const resume = resumeMap();
  const plan = files.map((f) => {
    const id = resume[fileKey(f)];
    const partial = STORE.files.find((x) => x.id === id && x.status !== 'COMPLETE' && x.size === f.size);
    return { file: f, id: partial ? partial.id : null, offset: partial ? partial.received : 0 };
  });
  const need = plan.filter((p) => !p.id).reduce((a, p) => a + p.file.size, 0);
  const free = Math.max(0, STORE.quota - STORE.used - STORE.reserved);
  if (need > free) { noRoom(files, need, free); return; }

  const job = startUpload();
  const ui = progressScreen(files);
  try {
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i];
      if (!p.id) {
        const v = await API.api('/api/files', {
          method: 'POST', auth: true,
          json: { name: p.file.name, size: p.file.size, contentType: p.file.type || null }
        });
        if (v.status === 'COMPLETE') { ui.done(i); continue; }
        p.id = v.id;
        resume[fileKey(p.file)] = p.id;
        saveResume(resume);
      }
      ui.file(i, p.offset);
      await pushContent(job, p.id, p.file, p.offset, (l) => ui.file(i, l));
      delete resume[fileKey(p.file)];
      saveResume(resume);
      ui.done(i);
    }
    myFiles();
  } catch (e) {
    if (job.aborted) { myFiles(); return; }
    if (lostSession(e)) return;
    if (e.status === 507) { await myFiles(); noRoom(files, need, Math.max(0, STORE.quota - STORE.used - STORE.reserved)); return; }
    failT(() => [t('send_fail_t'), t('send_fail', emsg(e)), t('back')]);
  }
}

/* ------------------------------------------------------------ admin */

let ADMIN_TAB = 'invites';

function admin() {
  if (!ME) { showLogin(); return; }
  if (ME.role !== 'ADMIN') { location.hash = ''; return; }
  show('s-admin');
  adminTab(ADMIN_TAB);
}

function adminTab(name) {
  ADMIN_TAB = name;
  document.querySelectorAll('[data-admin]').forEach((b) => {
    b.classList.toggle('on', b.dataset.admin === name);
    b.setAttribute('aria-pressed', String(b.dataset.admin === name));
  });
  $('adm-invites').hidden = name !== 'invites';
  $('adm-users').hidden = name !== 'users';
  $('adm-feedback').hidden = name !== 'feedback';
  $('adm-err').hidden = true;
  ({ invites: loadInvites, users: loadUsers, feedback: loadFeedback })[name]();
}

document.querySelectorAll('[data-admin]').forEach((b) => { b.onclick = () => adminTab(b.dataset.admin); });

async function adminCall(fn) {
  try {
    return await fn();
  } catch (e) {
    if (lostSession(e)) return undefined;
    $('adm-err').textContent = t('adm_fail', emsg(e));
    $('adm-err').hidden = false;
    return undefined;
  }
}

function inviteLink(code) {
  return location.origin + location.pathname + '#invite/' + code;
}

async function loadInvites() {
  const list = await adminCall(() => API.api('/api/invites', { auth: true }));
  if (!list) return;
  const paint = () => {
    const box = $('inv-list');
    box.innerHTML = '';
    if (!list.length) { box.append(item(t('inv_none'), '')); return; }
    list.forEach((inv) => {
      const expiredNow = !inv.usedBy && new Date(inv.expiresAt) <= new Date();
      const sub = inv.usedBy ? t('inv_used', inv.usedBy) + ' · ' + when(inv.usedAt)
        : expiredNow ? t('inv_expired') : t('inv_until', shortDate(new Date(inv.expiresAt)));
      const row = item(inv.code.slice(0, 12) + '…', sub, inv.usedBy || expiredNow ? 'dim' : '');
      if (!inv.usedBy && !expiredNow) {
        const c = el('button', 'mini', t('copy'));
        c.type = 'button';
        c.onclick = () => copyText(inviteLink(inv.code), c, 'copy');
        row.append(c);
      }
      box.append(row);
    });
  };
  paint();
  REPAINT = paint;
}

$('inv-new').onclick = async () => {
  const inv = await adminCall(() => API.api('/api/invites', { method: 'POST', auth: true, json: { ttlDays: 7 } }));
  if (!inv) return;
  const url = inviteLink(inv.code);
  $('inv-link').textContent = url.replace(/^https?:\/\//, '');
  $('inv-out').hidden = false;
  $('inv-copy').onclick = () => copyText(url, $('inv-new'), 'inv_new');
  loadInvites();
};

async function loadUsers() {
  const list = await adminCall(() => API.api('/api/users', { auth: true }));
  if (!list) return;
  const paint = () => {
    const box = $('adm-users');
    box.innerHTML = '';
    list.forEach((u) => {
      const bits = [u.role === 'ADMIN' ? t('role_admin') : null, u.enabled ? t('enabled') : t('disabled'), when(u.createdAt)];
      const row = item(u.username, bits.filter(Boolean).join(' · '), u.enabled ? '' : 'dim');
      if (u.id === ME.id) {
        row.append(el('span', 'tag-pill', t('you')));
      } else {
        const b = el('button', u.enabled ? 'mini kill' : 'mini', t(u.enabled ? 'disable' : 'enable'));
        b.type = 'button';
        b.onclick = async () => {
          const v = await adminCall(() => API.api('/api/users/' + u.id, {
            method: 'PATCH', auth: true, json: { enabled: !u.enabled }
          }));
          if (v) { Object.assign(u, v); paint(); }
        };
        row.append(b);
      }
      box.append(row);
    });
  };
  paint();
  REPAINT = paint;
}

async function loadFeedback() {
  const list = await adminCall(() => API.api('/api/feedback', { auth: true }));
  if (!list) return;
  const paint = () => {
    const box = $('adm-feedback');
    box.innerHTML = '';
    if (!list.length) { box.append(item(t('fb_none'), '')); return; }
    list.forEach((m) => {
      const row = el('div', 'item top-align' + (m.readAt ? '' : ' unread'));
      const nm = el('div', 'nm');
      nm.append(el('span', null, when(m.createdAt)), el('pre', null, m.body));
      row.append(nm);
      if (!m.readAt) {
        const b = el('button', 'mini', t('mark_read'));
        b.type = 'button';
        b.onclick = async () => {
          const ok = await adminCall(() => API.api('/api/feedback/' + m.id + '/read', { method: 'POST', auth: true }));
          if (ok !== undefined) { m.readAt = new Date().toISOString(); paint(); }
        };
        row.append(b);
      }
      box.append(row);
    });
  };
  paint();
  REPAINT = paint;
}

/* ------------------------------------------------------------ feedback */

function fbClose() { $('fb').hidden = true; }

$('foot-fb').onclick = (e) => {
  e.preventDefault();
  $('fb-err').hidden = true;
  $('fb').hidden = false;
  $('fb-msg').focus();
};
$('fb-close').onclick = fbClose;
$('fb').onclick = (e) => { if (e.target === $('fb')) fbClose(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('fb').hidden) fbClose(); });

$('fb-send').onclick = async () => {
  const message = $('fb-msg').value.trim();
  if (!message) { $('fb-msg').focus(); return; }
  const who = $('fb-who').value.trim();
  const contact = (who || '—') + '\n' + getLang() + ' · ' + new Date().toISOString() + '\n' + navigator.userAgent;
  if (message.length + contact.length + 6 > CFG.fbMax) {
    $('fb-err').textContent = t('fb_long');
    $('fb-err').hidden = false;
    return;
  }
  $('fb-err').hidden = true;
  $('fb-send').textContent = t('checking');
  try {
    await API.api('/api/feedback', { method: 'POST', json: { message, contact } });
    $('fb-send').textContent = t('fb_sent');
    $('fb-msg').value = '';
    $('fb-who').value = '';
    setTimeout(() => { fbClose(); $('fb-send').textContent = t('fb_send'); }, 1400);
  } catch (e) {
    $('fb-send').textContent = t('fb_send');
    $('fb-err').textContent = e.status === 429 ? t('fb_often') : e.status === 400 ? t('fb_long') : t('server', emsg(e));
    $('fb-err').hidden = false;
  }
};

/* ------------------------------------------------------------ swap events */

$('zone').onclick = () => $('picker').click();
$('my-zone').onclick = () => $('picker-my').click();
$('picker').onchange = function () { sendSwap(this.files); this.value = ''; };
$('picker-my').onchange = function () { sendMine(this.files); this.value = ''; };

[['zone', sendSwap], ['my-zone', sendMine]].forEach(([id, handler]) => {
  const zone = $(id);
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); }));
  ['dragleave', 'dragend'].forEach((ev) => zone.addEventListener(ev, () => zone.classList.remove('over')));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    if (e.dataTransfer && e.dataTransfer.files.length) handler(e.dataTransfer.files);
  });
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

$('form').onsubmit = (e) => {
  e.preventDefault();
  const v = $('code').value.trim().toUpperCase();
  if (v.length !== CFG.codeLength) {
    $('code').classList.add('bad');
    setTimeout(() => $('code').classList.remove('bad'), 1200);
    return;
  }
  location.hash = v;
};

$('code').addEventListener('input', function () {
  this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CFG.codeLength);
  this.classList.remove('bad');
});

$('tab-file').onclick = () => setTab(false);
$('tab-text').onclick = () => setTab(true);
$('send-text').onclick = () => {
  const txt = $('msg').value;
  if (!txt.trim()) { $('msg').focus(); return; }
  sendSwap([asFile(txt)]);
};

/* ------------------------------------------------------------ routing */

function route() {
  const h = decodeURIComponent((location.hash || '').replace(/^#/, ''));
  if (h === 'files') myFiles();
  else if (h === 'login') { if (ME) location.hash = 'files'; else showLogin(); }
  else if (h === 'register') showRegister();
  else if (h.startsWith('invite/')) showRegister(h.slice('invite/'.length));
  else if (h === 'account') showAccount();
  else if (h === 'admin') admin();
  // older links carried the lifetime as #CODE~15
  else if (h) openCode(h.split('~')[0]);
  else idle();
}

window.addEventListener('hashchange', route);

(async function boot() {
  setLangValue(pickLang());
  applyLang();
  document.querySelectorAll('[data-lang]').forEach((b) => { b.onclick = () => setLang(b.dataset.lang); });
  if (API.hasSession()) {
    try { await loadMe(); } catch (e) { ME = null; if (e instanceof API.SessionExpired) API.forget(); }
  }
  route();
})();
