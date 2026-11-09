import test from 'node:test';
import assert from 'node:assert/strict';
import { runSelfTest } from '../js/selftest.js';
import { generatePassword, generatePassphrase, generatePin, passwordEntropy, passphraseEntropy } from '../js/generator.js';
import { estimate } from '../js/strength.js';
import { VaultStore, importCSV, importBitwardenJSON, exportCSV, health, decryptBackup, newItem, matches, parseCSV } from '../js/vault.js';
import { chunkPayload, ChunkAssembler, parseChunk } from '../js/qr.js';
import { parseTotp } from '../js/totp.js';
import { sealText, openText, inspectSeal } from '../js/crypto.js';

class MemStorage { constructor() { this.m = new Map(); } getItem(k) { return this.m.has(k) ? this.m.get(k) : null; } setItem(k, v) { this.m.set(k, String(v)); } removeItem(k) { this.m.delete(k); } }
const FAST = { iterations: 100000 };

test('built-in known-answer self-test passes', async () => {
  const r = await runSelfTest();
  for (const x of r) assert.ok(x.ok, x.name + ' ' + x.err);
});

test('QR payload is the QR Seal v2 wire format', async () => {
  const p = await sealText('hello', 'pw', FAST);
  const raw = Buffer.from(p, 'base64');
  assert.equal(raw[0], 2);
  assert.equal(raw.readUInt32BE(1), 100000);
  assert.equal(raw.length, 5 + 16 + 12 + 5 + 16);
  assert.deepEqual(inspectSeal(p), { ok: true, version: 2, iterations: 100000, bytes: raw.length, ctLen: 5 });
  assert.equal(await openText(p, 'pw'), 'hello');
  assert.equal(inspectSeal('AAAA').ok, false);
});

test('generator: lengths, sets, ambiguity, passphrase, pin', () => {
  assert.equal(generatePassword({ length: 40 }).length, 40);
  assert.match(generatePassword({ length: 30, upper: false, symbols: false, digits: false }), /^[a-z]{30}$/);
  assert.doesNotMatch(generatePassword({ length: 200, noAmbiguous: true }), /[O0oIl1|`'"]/);
  assert.throws(() => generatePassword({ lower: false, upper: false, digits: false, symbols: false }));
  assert.equal(generatePassphrase({ words: 6, separator: '.' }).split('.').length, 6);
  assert.match(generatePin(8), /^\d{8}$/);
  assert.ok(Math.abs(passwordEntropy({ length: 20 }) - 20 * Math.log2(26 + 26 + 10 + 25)) < 1e-9);
  assert.ok(Math.abs(passphraseEntropy({ words: 5 }) - 5 * Math.log2(1296)) < 1e-9);
  const a = new Set(Array.from({ length: 50 }, () => generatePassword()));
  assert.equal(a.size, 50);
});

test('strength estimator ranks sensibly', () => {
  assert.ok(estimate('password').score === 0);
  assert.ok(estimate('Password1!').score <= 1);
  assert.ok(estimate('aaaaaaaaaaaa').score <= 1);
  assert.ok(estimate('qwertyuiop12').score <= 1);
  assert.ok(estimate('correct-horse-battery-staple-acid').score >= 2);
  assert.ok(estimate(generatePassword({ length: 24 })).score >= 3);
  assert.ok(estimate(generatePassphrase({ words: 6 })).bits > 60);
});

test('vault store: create, lock, unlock, persist, tamper, throttle', async () => {
  const st = new MemStorage();
  const v = new VaultStore(st);
  assert.equal(v.exists(), false);
  await v.create('correct horse battery', FAST);
  await v.add(newItem('login', { name: 'GitHub', username: 'me', password: 'S3cret!pass', url: 'https://github.com' }));
  const stored = st.getItem('vaultmanager.vault');
  assert.ok(!stored.includes('GitHub') && !stored.includes('S3cret'), 'plaintext must never reach storage');
  v.lock();
  assert.equal(v.unlocked, false);

  const w = new VaultStore(st);
  await assert.rejects(() => w.unlock({ password: 'wrong' }), /bad-secret/);
  await w.unlock({ password: 'correct horse battery' });
  assert.equal(w.active()[0].name, 'GitHub');

  // tamper with the ciphertext → integrity failure
  const rec = JSON.parse(st.getItem('vaultmanager.vault'));
  const ct = Buffer.from(rec.ct, 'base64'); ct[3] ^= 1; rec.ct = ct.toString('base64');
  st.setItem('vaultmanager.vault', JSON.stringify(rec));
  const x = new VaultStore(st);
  await assert.rejects(() => x.unlock({ password: 'correct horse battery' }), /integrity/);

  // lockout after repeated failures
  const y = new VaultStore(new MemStorage()); await y.create('another long password', FAST); y.lock();
  for (let i = 0; i < 3; i++) await assert.rejects(() => y.unlock({ password: 'bad' }), /bad-secret/);
  assert.ok(y.delayLeft() > 0);
  await assert.rejects(() => y.unlock({ password: 'another long password' }), /locked-out/);
});

test('vault store: password history, trash, change password, recovery', async () => {
  const st = new MemStorage();
  const v = new VaultStore(st);
  await v.create('first long password', FAST);
  const it = newItem('login', { name: 'A', password: 'one' });
  await v.add(it);
  await v.update(it.id, { password: 'two' });
  await v.update(it.id, { password: 'three' });
  assert.deepEqual(v.get(it.id).history.map((h) => h.pw), ['two', 'one']);
  await v.trash(it.id);
  assert.equal(v.active().length, 0); assert.equal(v.trashed().length, 1);
  await v.restore(it.id); assert.equal(v.active().length, 1);
  const rk = await v.session.createRecovery(); await v.save();
  await assert.rejects(() => v.changePassword('not it', 'second long password'), /wrong/);
  await v.changePassword('first long password', 'second long password');
  v.lock();
  const w = new VaultStore(st);
  await assert.rejects(() => w.unlock({ password: 'first long password' }), /bad-secret/);
  await w.unlock({ recovery: rk }); assert.equal(w.get(it.id).password, 'three'); w.lock();
  await w.unlock({ password: 'second long password' }); assert.equal(w.active().length, 1);
});

test('encrypted backup round trip and merge dedupe', async () => {
  const v = new VaultStore(new MemStorage());
  await v.create('backup test password', FAST);
  await v.add(newItem('login', { name: 'X', username: 'u', password: 'p@ss' }));
  await v.add(newItem('note', { name: 'N', notes: 'line1\nline2' }));
  const blob = await v.exportEncrypted('export-pass', FAST);
  assert.ok(blob.startsWith('VMX1:'));
  await assert.rejects(() => decryptBackup(blob, 'nope'), /Wrong password/);
  const items = await decryptBackup(blob, 'export-pass');
  assert.equal(items.length, 2);
  const r = v.mergeItems(items); await r.save;
  assert.deepEqual([r.added, r.skipped], [0, 2]);
  const w = new VaultStore(new MemStorage()); await w.create('another backup pass', FAST);
  const r2 = w.mergeItems(items); await r2.save; assert.equal(r2.added, 2);
});

test('CSV import (Chrome, Bitwarden, KeePassXC) and export round trip', () => {
  const chrome = 'name,url,username,password,note\nGitHub,https://github.com,me,"pa,ss""word",hello\n';
  const a = importCSV(chrome);
  assert.equal(a[0].password, 'pa,ss"word'); assert.equal(a[0].name, 'GitHub'); assert.equal(a[0].notes, 'hello');
  const kp = '"Group","Title","Username","Password","URL","Notes","TOTP"\n"Web","Bank","joe","=weird","https://b.example","multi\nline","JBSWY3DPEHPK3PXP"\n';
  const b = importCSV(kp);
  assert.equal(b[0].password, '=weird'); assert.equal(b[0].notes, 'multi\nline'); assert.equal(b[0].totp, 'JBSWY3DPEHPK3PXP'); assert.deepEqual(b[0].tags, ['Web']);
  const out = exportCSV([newItem('login', { name: '=cmd|x', username: 'u', password: '=keepme', url: 'https://x' })]);
  assert.ok(out.includes("'=cmd|x") && out.includes(',=keepme,'), 'formula guard on text, not on the password');
  const back = importCSV(out);
  assert.equal(back[0].name, '=cmd|x'); assert.equal(back[0].password, '=keepme');
  assert.throws(() => importCSV('a,b\n1,2\n'), /No password/);
  assert.equal(parseCSV('a,b\r\n1,"x\r\ny"\r\n').length, 2);
});

test('Bitwarden JSON import', () => {
  const j = JSON.stringify({ encrypted: false, folders: [{ id: 'f1', name: 'Work' }], items: [
    { type: 1, name: 'Mail', folderId: 'f1', favorite: true, login: { username: 'a', password: 'b', totp: 'JBSWY3DPEHPK3PXP', uris: [{ uri: 'https://mail.example' }] } },
    { type: 2, name: 'Note', notes: 'hi' }, { type: 3, name: 'Visa', card: { number: '4111', cardholderName: 'A B', expMonth: '1', expYear: '2030', code: '123' } }] });
  const r = importBitwardenJSON(j);
  assert.deepEqual(r.map((x) => x.type), ['login', 'note', 'card']);
  assert.equal(r[0].url, 'https://mail.example'); assert.deepEqual(r[0].tags, ['Work']); assert.equal(r[2].card.expiry, '1/2030');
  assert.throws(() => importBitwardenJSON('{"encrypted":true}'), /encrypted/);
});

test('vault health: weak, reused, old, insecure', () => {
  const day = 864e5, now = Date.now();
  const items = [
    newItem('login', { name: 'a', password: 'password', url: 'http://a.example' }),
    newItem('login', { name: 'b', password: 'Tr0ub4dor&3-long-enough-xyz' }),
    newItem('login', { name: 'c', password: 'Tr0ub4dor&3-long-enough-xyz', pwChanged: now - 400 * day }),
    newItem('login', { name: 'd', password: generatePassword({ length: 24 }) }),
    newItem('note', { name: 'n' }),
  ];
  const h = health(items, now);
  assert.equal(h.weak.length, 1); assert.equal(h.reused.length, 1); assert.equal(h.reused[0].length, 2);
  assert.equal(h.old.length, 1); assert.equal(h.insecure.length, 1); assert.equal(h.total, 4);
  assert.ok(h.score < 100 && h.score >= 0);
  assert.equal(health([newItem('login', { password: generatePassword({ length: 24 }) })]).score, 100);
});

test('search', () => {
  const it = newItem('login', { name: 'GitHub', username: 'octo', url: 'https://github.com', tags: ['dev'] });
  assert.ok(matches(it, 'git octo')); assert.ok(matches(it, 'DEV')); assert.ok(!matches(it, 'gitlab'));
});

test('multi-QR chunking reassembles in any order, rejects foreign sets', async () => {
  const payload = 'VMX1:' + Buffer.from(crypto.getRandomValues(new Uint8Array(3000))).toString('base64');
  const chunks = chunkPayload(payload, 700);
  assert.ok(chunks.length >= 6);
  const a = new ChunkAssembler();
  for (const c of [...chunks].reverse()) a.add(c);
  assert.equal(a.payload(), payload);
  assert.equal(a.add(chunks[0]).status, 'dup');
  const b = new ChunkAssembler(); b.add(chunks[0]);
  assert.equal(b.add(chunkPayload('xx', 10)[0]).status, 'other-set');
  assert.throws(() => b.payload(), /Not all/);
  assert.equal(parseChunk('hello'), null);
});

test('totp parsing', () => {
  const c = parseTotp('otpauth://totp/Acme:me@x.com?secret=JBSWY3DPEHPK3PXP&issuer=Acme&digits=8&period=60&algorithm=SHA256');
  assert.deepEqual([c.digits, c.period, c.algo, c.issuer], [8, 60, 'SHA256', 'Acme']);
  assert.throws(() => parseTotp('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP'));
  assert.throws(() => parseTotp('not base32 !!'));
});
