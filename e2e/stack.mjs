// End-to-end run against a live stack: node e2e/stack.mjs <base url> <admin user> <admin password> [screenshot dir]
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const [base, adminUser, adminPassword, shots] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: 'ru-RU', acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });

const shot = async (name, p = page) => { if (shots) await p.screenshot({ path: `${shots}/${name}.png`, fullPage: true }); };
const step = (name) => console.log('•', name);

step('swap: two files, the second name repeats');
await page.goto(base + '/');
await shot('01-idle');
await page.setInputFiles('#picker', [
  { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('first file') },
  { name: 'A.txt', mimeType: 'text/plain', buffer: Buffer.from('second file') }
]);
await page.waitForSelector('#s-ready:not([hidden])');
const code = (await page.textContent('#out-code')).trim();
assert.match(code, /^[2-9A-Z]{6}$/);
assert.ok(await page.$('#out-qr svg'));
await shot('02-ready');

step('swap: receive by code');
const recv = await ctx.newPage();
await recv.goto(base + '/#' + code);
await recv.waitForSelector('#recv-list .item');
assert.equal(await recv.locator('#recv-list .item').count(), 2);
assert.equal(await recv.textContent('#recv-title'), '2 файла');
const names = await recv.locator('#recv-list .item b').allTextContents();
assert.deepEqual(names.sort(), ['A (1).txt', 'a.txt']);
const href = await recv.getAttribute('#recv-all', 'href');
assert.ok(href.endsWith('/archive'));
const zip = await recv.request.get(base + href);
assert.equal(zip.status(), 200);
await shot('03-receive', recv);

step('swap: text note with 15 minutes');
await page.goto(base + '/');
await page.click('#tab-text');
await page.click('#ttls button:first-child');
const note = 'привет, это записка\nвторая строка';
await page.fill('#msg', note);
await page.click('#send-text');
await page.waitForSelector('#s-ready:not([hidden])');
const noteCode = (await page.textContent('#out-code')).trim();
const left = new Date(Date.now() + 15 * 60000);
assert.match(await page.textContent('#out-when'), new RegExp(String(left.getMinutes()).padStart(2, '0')));
await recv.goto(base + '/#' + noteCode);
await recv.waitForSelector('#recv-text:not([hidden])');
assert.equal(await recv.textContent('#recv-text'), note);
await shot('04-note', recv);

step('swap: unknown code');
await recv.goto(base + '/#ZZZZZ2');
await recv.waitForSelector('#s-err:not([hidden])');
assert.equal(await recv.textContent('#err-title'), 'код не найден');

step('feedback');
await page.goto(base + '/');
await page.click('#foot-fb');
await page.fill('#fb-msg', 'e2e feedback ' + code);
await page.fill('#fb-who', '@e2e');
await page.click('#fb-send');
await page.waitForFunction(() => document.querySelector('#fb-send').textContent === 'спасибо');

step('admin: sign in, invite, read feedback');
await page.goto(base + '/#login');
await page.fill('#l-name', adminUser);
await page.fill('#l-pw', 'wrong-password');
await page.click('#l-go');
await page.waitForSelector('#l-err:not([hidden])');
await page.fill('#l-pw', adminPassword);
await page.click('#l-go');
await page.waitForSelector('#s-files:not([hidden])');
assert.ok(await page.isVisible('#nav-a'));
await page.click('#nav-a');
await page.waitForSelector('#s-admin:not([hidden])');
await page.click('#inv-new');
await page.waitForSelector('#inv-out:not([hidden])');
const inviteUrl = 'http://' + (await page.textContent('#inv-link'));
assert.match(inviteUrl, /#invite\/[0-9a-f]{64}$/);
await page.click('[data-admin="feedback"]');
await page.waitForSelector('#adm-feedback .item');
assert.ok((await page.textContent('#adm-feedback')).includes('e2e feedback ' + code));
await shot('05-admin-feedback');
await page.click('[data-admin="users"]');
await page.waitForSelector('#adm-users .item');
await page.click('#logout');
await page.waitForSelector('#s-idle:not([hidden])');

step('register by invite');
const invite = inviteUrl.split('#invite/')[1];
await page.goto(base + '/#invite/' + invite);
assert.equal(await page.inputValue('#r-invite'), invite);
const user = 'e2e_' + Date.now().toString(36);
await page.fill('#r-name', user);
await page.fill('#r-pw', 'short');
await page.click('#r-go');
await page.waitForSelector('#r-err:not([hidden])');
await page.fill('#r-pw', 'correct horse battery');
await page.click('#r-go');
await page.waitForSelector('#s-files:not([hidden])');
await page.waitForSelector('#my-empty:not([hidden])');
assert.ok(!(await page.isVisible('#nav-a')));
await shot('06-files-empty');

step('my files: upload survives a dropped request');
let dropped = false;
await page.route('**/api/files/*/content', (route) => {
  if (!dropped && route.request().method() === 'PUT') { dropped = true; return route.abort('connectionreset'); }
  return route.continue();
});
const body = Buffer.alloc(300 * 1024, 7);
await page.setInputFiles('#picker-my', [{ name: 'report.pdf', mimeType: 'application/pdf', buffer: body }]);
await page.waitForSelector('#my-list .item');
assert.ok(dropped);
assert.equal(await page.locator('#my-list .item').count(), 1);
assert.match(await page.textContent('#q-used'), /300 КБ/);
await page.unroute('**/api/files/*/content');

step('my files: same name gets a suffix, download works');
await page.setInputFiles('#picker-my', [{ name: 'report.pdf', mimeType: 'application/pdf', buffer: Buffer.from('v2') }]);
await page.waitForFunction(() => document.querySelectorAll('#my-list .item').length === 2);
assert.ok((await page.textContent('#my-list')).includes('report (1).pdf'));
await shot('07-files');
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('#my-list .item', { hasText: 'report (1).pdf' }).locator('a.icon').click()
]);
assert.equal(download.suggestedFilename(), 'report (1).pdf');

step('my files: delete');
await page.locator('#my-list .item', { hasText: 'report (1).pdf' }).locator('button.icon').click();
await page.click('#my-list .mini.kill');
await page.waitForFunction(() => document.querySelectorAll('#my-list .item').length === 1);

step('session survives reload, password change, english');
await page.reload();
await page.waitForSelector('#s-files:not([hidden])');
await page.click('#who-name');
await page.fill('#p-old', 'correct horse battery');
await page.fill('#p-new', 'another horse battery');
await page.click('#p-go');
await page.waitForFunction(() => document.querySelector('#p-go').textContent === 'пароль изменён');
await page.click('[data-lang="en"]');
assert.equal(await page.textContent('#nav-x'), 'file swap');
await page.click('#nav-f');
await page.waitForSelector('#my-list .item');
await shot('08-files-en');

const mobile = await browser.newContext({ viewport: { width: 375, height: 780 }, colorScheme: 'dark', locale: 'ru-RU' });
const phone = await mobile.newPage();
await phone.goto(base + '/#' + code);
await phone.waitForSelector('#recv-list .item');
await shot('09-phone-dark-receive', phone);
await phone.goto(base + '/');
await phone.click('#foot-fb');
await shot('10-phone-dark-feedback', phone);

await browser.close();
assert.deepEqual(errors, []);
console.log('ok');
