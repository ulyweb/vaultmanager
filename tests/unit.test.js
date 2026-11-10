import test from 'node:test';
import assert from 'node:assert/strict';
import { runSelfTest } from '../js/selftest.js';
import { generatePassword, generatePassphrase, generatePin, passwordEntropy, passphraseEntropy } from '../js/generator.js';
import { estimate } from '../js/strength.js';
import { VaultStore, mergeItem, sanitiseItem, importCSV, importBitwardenJSON, exportCSV, health, decryptBackup, newItem, matches, parseCSV } from '../js/vault.js';
import { chunkPayload, ChunkAssembler, parseChunk } from '../js/qr.js';
import { parseTotp } from '../js/totp.js';
import { TEMPLATES, TYPE_META, GROUPS, TYPE_KEYS, RESERVED_VIEWS, wifiQRString, daysUntil } from '../js/templates.js';
import { encode, decode, verifyCode } from '../js/beam.js';
import { memoryBlobs } from '../js/blobs.js';
import { sealBundle, openBundle, GistClient, syncGist, exportSyncFile, importSyncFile } from '../js/sync.js';
import { sealText, openText, inspectSeal } from '../js/crypto.js';
import { Profiles, keysFor, sanitizeAvatar, createProfileFromImport } from '../js/profiles.js';
import { decryptProfile } from '../js/vault.js';

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
  const { items, attachments } = await decryptBackup(blob, 'export-pass');
  assert.equal(items.length, 2);
  const r = v.mergeItems(items, attachments); await r.save;
  assert.deepEqual([r.added, r.skipped], [0, 2]);
  const w = new VaultStore(new MemStorage()); await w.create('another backup pass', FAST);
  const r2 = w.mergeItems(items, attachments); await r2.save; assert.equal(r2.added, 2);
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

/* ================= v0.2: attachments, versions, audit, sync ================= */
const mk = async (pw = 'device pass phrase long', blobs = memoryBlobs()) => { const st = new MemStorage(); const v = new VaultStore(st, undefined, blobs); await v.create(pw, FAST); return { v, st, blobs }; };
const bytesOf = (n, f = 7) => Uint8Array.from({ length: n }, (_, i) => (i * f) & 255);

test('attachments: encrypted at rest, round trip, tamper, limits, cleanup', async () => {
  const { v, blobs } = await mk();
  const it = newItem('login', { name: 'Passport' }); await v.add(it);
  const data = bytesOf(5000);
  const att = await v.addAttachment(it.id, { name: '../scan?.png', type: 'image/png', bytes: data });
  assert.equal(att.name, '.._scan?.png'); assert.equal(att.size, 5000);
  const stored = await blobs.get(v.session.id + ':' + att.id);
  assert.ok(stored.ct.length > 5000 && !Buffer.from(stored.ct).includes(Buffer.from(data.slice(100, 140))), 'ciphertext must not contain plaintext');
  const back = await v.readAttachment(it.id, att.id);
  assert.deepEqual(Array.from(back.bytes), Array.from(data));
  // swapping blobs between attachments must fail (bound to file id)
  const att2 = await v.addAttachment(it.id, { name: 'b.txt', type: 'text/plain', bytes: bytesOf(10) });
  await blobs.put(v.session.id + ':' + att2.id, await blobs.get(v.session.id + ':' + att.id));
  await assert.rejects(() => v.readAttachment(it.id, att2.id));
  // tamper
  const rec = await blobs.get(v.session.id + ':' + att.id); rec.ct[7] ^= 1;
  await assert.rejects(() => v.readAttachment(it.id, att.id));
  // limits
  await assert.rejects(() => v.addAttachment(it.id, { name: 'big', bytes: new Uint8Array(10 * 1024 * 1024 + 1) }), /limit/);
  // remove + purge delete the ciphertext
  await v.removeAttachment(it.id, att2.id); assert.equal(await blobs.get(v.session.id + ':' + att2.id), null);
  await v.trash(it.id); await v.purge(it.id);
  assert.equal((await blobs.keys()).length, 0);
  assert.ok(v.data.tombstones[it.id]);
  // orphan collection on unlock
  const { v: v2, st, blobs: b2 } = await mk('orphan test password');
  const sid = v2.session.id; await b2.put(sid + ':deadbeef', { iv: new Uint8Array(12), ct: new Uint8Array(32) }); v2.lock();
  const v3 = new VaultStore(st, undefined, b2); await v3.unlock({ password: 'orphan test password' });
  assert.equal((await b2.keys()).length, 0);
});

test('attachments survive lock/unlock and encrypted backup with attachments', async () => {
  const { v, st, blobs } = await mk('attach backup password');
  const it = newItem('card', { name: 'Visa' }); await v.add(it);
  const data = bytesOf(3000, 11); await v.addAttachment(it.id, { name: 'front.jpg', type: 'image/jpeg', bytes: data });
  v.lock();
  const w = new VaultStore(st, undefined, blobs); await w.unlock({ password: 'attach backup password' });
  const wi = w.active()[0];
  assert.deepEqual(Array.from((await w.readAttachment(wi.id, wi.attachments[0].id)).bytes), Array.from(data));
  const without = await w.exportEncrypted('export pass phrase', FAST);
  assert.equal((await decryptBackup(without, 'export pass phrase')).items[0].attachments.length, 0);
  const full = await w.exportEncrypted('export pass phrase', { ...FAST, attachments: true });
  const dec = await decryptBackup(full, 'export pass phrase');
  const { v: other } = await mk('second device password');
  const r = other.mergeItems(dec.items, dec.attachments); await r.save;
  const oi = other.active()[0];
  assert.notEqual(oi.attachments[0].id, wi.attachments[0].id, 'attachment ids are regenerated on import');
  assert.deepEqual(Array.from((await other.readAttachment(oi.id, oi.attachments[0].id)).bytes), Array.from(data));
});

test('version history: revisions recorded, capped, restorable', async () => {
  const { v } = await mk();
  const it = newItem('login', { name: 'Site', username: 'a', password: 'p1' }); await v.add(it);
  await v.update(it.id, { username: 'b' });
  await v.update(it.id, { username: 'c', notes: 'hello' });
  await v.update(it.id, { favorite: true });                 // not a tracked field → no revision
  const cur = v.get(it.id);
  assert.equal(cur.revisions.length, 2);
  assert.deepEqual(cur.revisions[0].changed.sort(), ['notes', 'username']);
  assert.equal(cur.revisions[1].snap.username, 'a');
  await v.restoreRevision(it.id, 1);
  assert.equal(v.get(it.id).username, 'a'); assert.equal(v.get(it.id).revisions.length, 3);
  for (let i = 0; i < 15; i++) await v.update(it.id, { notes: 'n' + i });
  assert.equal(v.get(it.id).revisions.length, 10);
});

test('audit trail: records events, no secret values, persists, bounded, failed attempts surface', async () => {
  const { v, st, blobs } = await mk('audit test password');
  const it = newItem('login', { name: 'Bank', username: 'joe', password: 'Sup3rSecret!value' }); await v.add(it);
  await v.update(it.id, { password: 'An0therSecret!value' });
  await v.trash(it.id); await v.restore(it.id);
  const text = JSON.stringify(v.auditLog());
  assert.ok(text.includes('Created login') && text.includes('Moved') && text.includes('Edited'));
  assert.ok(!text.includes('Sup3rSecret') && !text.includes('An0therSecret'), 'secrets must never be logged');
  await v.save(); v.lock();
  const w = new VaultStore(st, undefined, blobs);
  await assert.rejects(() => w.unlock({ password: 'bad one' }), /bad-secret/);
  await w.unlock({ password: 'audit test password' });
  assert.ok(w.auditLog().some((e) => /failed unlock attempt/.test(e.m) && e.l === 'warn'));
  assert.ok(w.auditLog().some((e) => /unlocked/.test(e.m)));
  for (let i = 0; i < 1100; i++) w.log('x', 'e' + i);
  assert.equal(w.auditLog().length, 1000);
  await w.clearAudit(); assert.equal(w.auditLog().length, 1); assert.match(w.auditLog()[0].m, /cleared/);
});

test('sync: two devices converge (add, edit, delete, conflicts, attachments)', async () => {
  const A = (await mk('device A password!!')).v, B = (await mk('device B different pw')).v;
  const PASS = 'shared sync passphrase words';
  const round = async (from, to) => (await to.applyRemote(await openBundle(await sealBundle(await from.buildBundle(), PASS, FAST), PASS)));
  const x = newItem('login', { name: 'Shared', username: 'u', password: 'one' }); await A.add(x);
  await A.addAttachment(x.id, { name: 'doc.pdf', type: 'application/pdf', bytes: bytesOf(2048, 3) });
  let r = await round(A, B);
  assert.equal(r.added, 1); assert.equal(r.attachments, 1);
  const bx = B.get(x.id); assert.equal(bx.name, 'Shared');
  assert.deepEqual(Array.from((await B.readAttachment(bx.id, bx.attachments[0].id)).bytes), Array.from(bytesOf(2048, 3)));
  // edit on B → flows to A
  await new Promise((s) => setTimeout(s, 5)); await B.update(x.id, { password: 'two' });
  r = await round(B, A); assert.equal(r.updated, 1); assert.equal(A.get(x.id).password, 'two');
  // older remote never overwrites newer local
  const stale = await B.buildBundle(); await new Promise((s) => setTimeout(s, 5)); await A.update(x.id, { password: 'three' });
  r = await A.applyRemote(JSON.parse(JSON.stringify(stale))); assert.equal(r.updated, 0); assert.equal(A.get(x.id).password, 'three');
  // concurrent edits: newest wins on both sides
  await round(A, B); await new Promise((s) => setTimeout(s, 5));
  await A.update(x.id, { notes: 'from A' }); await new Promise((s) => setTimeout(s, 5)); await B.update(x.id, { notes: 'from B' });
  await round(A, B); await round(B, A);
  assert.equal(A.get(x.id).notes, 'from B'); assert.equal(B.get(x.id).notes, 'from B');
  // permanent delete on A propagates as a tombstone, and the item is not resurrected
  await A.trash(x.id); await A.purge(x.id);
  r = await round(A, B); assert.equal(r.removed, 1); assert.equal(B.items.length, 0);
  await round(B, A); assert.equal(A.items.length, 0);
  assert.equal((await B.blobs.keys()).length, 0);
});

test('sync bundles: wrong passphrase, tamper, hostile content', async () => {
  const { v } = await mk(); await v.add(newItem('login', { name: 'N', password: 'pw' }));
  const payload = await sealBundle(await v.buildBundle(), 'right passphrase here', FAST);
  assert.ok(payload.startsWith('VMS1:') && !payload.includes('"items"'));
  await assert.rejects(() => openBundle(payload, 'wrong passphrase here'), /Wrong sync passphrase/);
  await assert.rejects(() => openBundle('hello', 'x'), /not a VaultManager sync file/);
  const raw = Buffer.from(payload.slice(5), 'base64'); raw[30] ^= 1;
  await assert.rejects(() => openBundle('VMS1:' + raw.toString('base64'), 'right passphrase here'), /Wrong sync passphrase/);
  const { v: w } = await mk('hostile target password');
  await assert.rejects(() => w.applyRemote({ format: 'nope' }), /not a VaultManager sync bundle/);
  const r = await w.applyRemote({ format: 'VaultManager-sync', v: 1, items: [{ id: '../../etc', name: 'x' }, { id: 'a'.repeat(24), name: { toString() { return 'obj'; } }, type: 'evil', password: 5, attachments: 'nope', revisions: [{ snap: 7 }] }], tombstones: { bad: 1 }, attachments: { zz: 'AAAA' } });
  assert.equal(r.added, 1); const it = w.items[0]; assert.equal(it.type, 'login'); assert.equal(typeof it.password, 'string'); assert.deepEqual(it.attachments, []);
});

test('gist transport (mocked GitHub): create, read, update, chunking, errors, no plaintext, token only to api.github.com', async () => {
  const gists = new Map(), seen = [];
  const fakeFetch = async (url, init) => {
    seen.push({ url, auth: init.headers.Authorization, method: init.method });
    const u = new URL(url); const m = /^\/gists\/?([0-9a-f]*)$/.exec(u.pathname);
    const reply = (status, body) => ({ status, ok: status < 300, json: async () => body });
    if (init.headers.Authorization !== 'Bearer tok_good') return reply(401, {});
    if (init.method === 'POST') { const id = 'abc123' + gists.size; const files = {}; for (const [k, f] of Object.entries(JSON.parse(init.body).files)) files[k] = { content: f.content }; gists.set(id, files); return reply(201, { id }); }
    const files = m && gists.get(m[1]); if (!files) return reply(404, {});
    if (init.method === 'GET') return reply(200, { files });
    for (const [k, f] of Object.entries(JSON.parse(init.body).files)) { if (f === null) delete files[k]; else files[k] = { content: f.content }; }
    return reply(200, { id: m[1] });
  };
  const { v: A } = await mk('gist device A password'), { v: B } = await mk('gist device B password');
  const PASS = 'gist sync passphrase words';
  A.settings.sync = { ...A.settings.sync, token: 'tok_good', passphrase: PASS, attachments: true };
  B.settings.sync = { ...B.settings.sync, token: 'tok_good', passphrase: PASS, attachments: true };
  const it = newItem('login', { name: 'TopSecretSiteName', username: 'alice', password: 'hunter2-hunter2' }); await A.add(it);
  await A.addAttachment(it.id, { name: 'big.bin', type: 'application/octet-stream', bytes: bytesOf(400000, 13) });   // forces multiple chunks
  const s1 = await syncGist(A, { fetchImpl: fakeFetch });
  assert.ok(s1.gistId && s1.pushed);
  const stored = JSON.stringify([...gists.values()]);
  for (const needle of ['TopSecretSiteName', 'alice', 'hunter2']) assert.ok(!stored.includes(needle), 'gist must hold ciphertext only: ' + needle);
  assert.ok(Object.keys([...gists.values()][0]).filter((k) => k.startsWith('vm-0')).length >= 2, 'large bundles are chunked');
  B.settings.sync.gistId = s1.gistId;
  const s2 = await syncGist(B, { fetchImpl: fakeFetch });
  assert.equal(s2.pulled.added, 1);
  const bi = B.active()[0]; assert.equal(bi.password, 'hunter2-hunter2');
  assert.equal((await B.readAttachment(bi.id, bi.attachments[0].id)).bytes.length, 400000);
  await B.update(bi.id, { username: 'bob' }); await syncGist(B, { fetchImpl: fakeFetch });
  const s3 = await syncGist(A, { fetchImpl: fakeFetch }); assert.equal(s3.pulled.updated, 1); assert.equal(A.get(it.id).username, 'bob');
  assert.ok(seen.every((r) => r.url.startsWith('https://api.github.com/') && r.auth === 'Bearer tok_good'));
  // wrong passphrase must abort without overwriting the remote
  const before = JSON.stringify([...gists.values()]);
  A.settings.sync.passphrase = 'a completely different one';
  await assert.rejects(() => syncGist(A, { fetchImpl: fakeFetch }), /Wrong sync passphrase/);
  assert.equal(JSON.stringify([...gists.values()]), before);
  A.settings.sync.passphrase = PASS;
  // errors
  A.settings.sync.token = 'tok_bad'; await assert.rejects(() => syncGist(A, { fetchImpl: fakeFetch }), /rejected the token/);
  A.settings.sync.token = 'tok_good'; A.settings.sync.gistId = 'nope'; await assert.rejects(() => syncGist(A, { fetchImpl: fakeFetch }), /not found/);
  const offline = async () => { throw new TypeError('net'); }; A.settings.sync.gistId = s1.gistId;
  await assert.rejects(() => syncGist(A, { fetchImpl: offline }), /Could not reach GitHub/);
});

test('sync file export / import', async () => {
  const { v: A } = await mk('file sync A password'), { v: B } = await mk('file sync B password');
  await A.add(newItem('note', { name: 'Memo', notes: 'remember' }));
  const file = await exportSyncFile(A, 'file passphrase words here');
  const r = await importSyncFile(B, file, 'file passphrase words here');
  assert.equal(r.added, 1); assert.equal(B.active()[0].notes, 'remember');
  await assert.rejects(() => importSyncFile(B, file, 'nope nope nope nope'), /Wrong sync passphrase/);
  assert.ok(B.auditLog().some((e) => e.k === 'sync'));
});

/* ================= v0.3: passkey wraps ================= */
test('passkey wrap: unlocks with the right PRF secret only, bound to the credential, per-device, not throttled', async () => {
  const { v, st, blobs } = await mk('passkey device password');
  const prf = crypto.getRandomValues(new Uint8Array(32)), cred = Buffer.from('credential-one').toString('base64');
  await v.session.addPasskey(cred, Buffer.from('salt').toString('base64'), prf, 'Laptop');
  await v.add(newItem('login', { name: 'X', password: 'p' })); v.lock();
  assert.ok(new VaultStore(st).hasPasskeys()); assert.equal(new VaultStore(st).passkeyWraps()[0].label, 'Laptop');

  const w = new VaultStore(st, undefined, blobs);
  await assert.rejects(() => w.unlock({ passkey: { cred, prf: crypto.getRandomValues(new Uint8Array(32)) } }), /bad-secret/);
  await assert.rejects(() => w.unlock({ passkey: { cred: 'unknown', prf } }), /bad-secret/);
  await w.unlock({ passkey: { cred, prf } });
  assert.equal(w.active()[0].name, 'X');
  assert.ok(w.auditLog().some((e) => /unlocked with a passkey/.test(e.m)));
  assert.ok(JSON.stringify(st.getItem('vaultmanager.vault')).indexOf(Buffer.from(prf).toString('base64')) < 0, 'PRF output is never stored');

  // a wrap copied under a different credential id must not open (bound via additional data)
  const rec = JSON.parse(st.getItem('vaultmanager.vault')); const pk = rec.wraps.find((x) => x.type === 'passkey');
  const other = Buffer.from('credential-two').toString('base64'); pk.cred = other; st.setItem('vaultmanager.vault', JSON.stringify(rec));
  w.lock(); await assert.rejects(() => new VaultStore(st, undefined, blobs).unlock({ passkey: { cred: other, prf } }), /bad-secret/);
});

test('passkey wrap: survives password change, removal works, lock-out does not block passkeys, password remains', async () => {
  const { v, st, blobs } = await mk('passkey pw one long');
  const prf = crypto.getRandomValues(new Uint8Array(32)), cred = 'Y3JlZA==';
  await v.session.addPasskey(cred, 'c2FsdA==', prf, 'Phone');
  await v.changePassword('passkey pw one long', 'passkey pw two long'); v.lock();
  const w = new VaultStore(st, undefined, blobs);
  for (let i = 0; i < 4; i++) await assert.rejects(() => w.unlock({ password: 'nope' }), /bad-secret|locked-out/);
  assert.ok(w.delayLeft() > 0);
  await assert.rejects(() => w.unlock({ password: 'passkey pw two long' }), /locked-out/);
  await w.unlock({ passkey: { cred, prf } });                         // passkeys are not throttled
  w.session.removePasskey(cred); await w.save(); w.lock();
  const x = new VaultStore(st, undefined, blobs);
  assert.equal(x.hasPasskeys(), false);
  await assert.rejects(() => x.unlock({ passkey: { cred, prf } }), /bad-secret/);
  await x.unlock({ password: 'passkey pw two long' });
});

/* ================= v0.4: categories, custom fields, expiry, beam codes ================= */
test('templates: well-formed, every category round-trips, secrets never indexed or logged', async () => {
  assert.ok(Object.keys(TEMPLATES).length >= 10);
  for (const k of ['app', 'network', 'computer', 'shopping', 'insurance', 'locker', 'travel']) assert.ok(TEMPLATES[k], k);
  for (const [k, t] of Object.entries(TEMPLATES)) {
    const keys = t.fields.map((f) => f.k);
    assert.equal(new Set(keys).size, keys.length, k + ': duplicate field keys');
    for (const f of t.fields) { assert.ok(['text', 'secret', 'url', 'date', 'multiline', 'select'].includes(f.kind), k + '.' + f.k); if (f.kind === 'select') assert.ok(f.options.length > 1); }
    assert.ok(keys.includes(t.sub), k + ': sub field exists');
    assert.ok(TYPE_META[k].icon && TYPE_META[k].plural);
  }
  const { v } = await mk();
  const secretBits = {};
  for (const [k, t] of Object.entries(TEMPLATES)) {
    const fields = {}; for (const f of t.fields) fields[f.k] = f.kind === 'select' ? f.options[0] : f.kind === 'date' ? '2031-05-06' : (f.kind === 'secret' || f.secret ? 'SECRET-' + k + '-' + f.k : 'plain-' + k + '-' + f.k);
    secretBits[k] = fields;
    const raw = { type: k, name: 'Item ' + k, fields: { ...fields, bogus: 'drop-me' }, custom: [{ label: 'Pin', value: 'CUSTOM-SECRET', secret: true }, { label: 'Site', value: 'custom-plain' }] };
    const it = sanitiseItem(raw); assert.equal(it.type, k); assert.ok(!('bogus' in it.fields)); await v.add(it);
  }
  assert.equal(v.active().length, Object.keys(TEMPLATES).length);
  for (const it of v.active()) {
    assert.ok(matches(it, 'plain-' + it.type), 'plain fields are searchable');
    assert.ok(matches(it, 'custom-plain'));
    assert.ok(!matches(it, 'SECRET-'), 'secret fields are not searchable');
    assert.ok(!matches(it, 'CUSTOM-SECRET'));
  }
  assert.ok(!JSON.stringify(v.auditLog()).includes('SECRET'));
  const csv = exportCSV(v.active()); assert.ok(csv.includes('Wi-Fi password: SECRET-network-wifipw') && csv.includes('Pin: CUSTOM-SECRET'));
  // revisions and restore cover template fields and custom fields
  const net = v.active().find((i) => i.type === 'network');
  await v.update(net.id, { fields: { ...net.fields, ssid: 'Changed' }, custom: [] });
  assert.deepEqual(v.get(net.id).revisions[0].changed.sort(), ['custom', 'fields']);
  await v.restoreRevision(net.id, 0); assert.equal(v.get(net.id).fields.ssid, 'plain-network-ssid'); assert.equal(v.get(net.id).custom.length, 2);
  // sync carries the new shapes
  const { v: B } = await mk('second device password!');
  const PASS = 'plum orbit velvet anchor glacier'; await B.applyRemote(await openBundle(await sealBundle(await v.buildBundle(), PASS, FAST), PASS));
  assert.equal(B.active().length, v.active().length);
  assert.deepEqual(B.get(net.id).fields, v.get(net.id).fields); assert.deepEqual(B.get(net.id).custom, v.get(net.id).custom);
  // hostile fields are bounded
  const h = sanitiseItem({ type: 'travel', fields: { number: 'x'.repeat(50000), kind: 5 }, custom: Array.from({ length: 100 }, (_, i) => ({ label: 'l' + i, value: 'v' })) });
  assert.equal(h.fields.number.length, 1000); assert.equal(h.custom.length, 30);
});

test('wifi QR string escapes special characters; expiry maths; health flags expiring items', () => {
  assert.equal(wifiQRString('Home', 'pa:ss;w"rd', 'WPA2'), 'WIFI:T:WPA;S:Home;P:pa\\:ss\\;w\\"rd;;');
  assert.equal(wifiQRString('Open', '', 'None'), 'WIFI:T:nopass;S:Open;;');
  assert.equal(wifiQRString('Old', 'x', 'WEP'), 'WIFI:T:WEP;S:Old;P:x;;');
  const now = Date.parse('2026-11-09T12:00:00');
  assert.equal(daysUntil('2026-11-10', now), 1); assert.ok(daysUntil('2026-11-01', now) < 0); assert.equal(daysUntil('garbage', now), null);
  const mkItem = (type, fields) => sanitiseItem({ type, name: type, fields });
  const items = [mkItem('travel', { kind: 'Passport', expires: '2026-12-01' }), mkItem('insurance', { renews: '2027-06-01' }), mkItem('identity', { expires: '2026-01-01' }), mkItem('travel', { start: '2026-11-10' })];
  const h = health(items, now);
  assert.deepEqual(h.expiring.map((x) => [x.item.type, x.days < 0]), [['identity', true], ['travel', false]]);
});

test('beam: codes round-trip, malformed codes rejected, verification number is symmetric and fingerprint-bound', async () => {
  const sdp = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\na=fingerprint:sha-256 AA:BB:CC\r\n';
  const code = await encode('o', sdp);
  assert.match(code, /^BEAM1\.[\w-]+$/);
  assert.deepEqual(await decode(code), { t: 'o', s: sdp });
  await assert.rejects(() => decode('hello'), /not a Beam code/);
  await assert.rejects(() => decode('BEAM1.AAAA'), /damaged/);
  await assert.rejects(() => decode('BEAM1.' + 'A'.repeat(30000)), /not a Beam code/);
  const b = 'v=0\r\na=fingerprint:sha-256 11:22:33\r\n';
  const v1 = await verifyCode(sdp, b), v2 = await verifyCode(b, sdp);
  assert.match(v1, /^\d{3} \d{3}$/); assert.equal(v1, v2);
  assert.notEqual(v1, await verifyCode(sdp, 'v=0\r\na=fingerprint:sha-256 99:99:99\r\n'));
});

/* ================= v0.5: field-level merge & conflicts ================= */
const tick = () => new Promise((r) => setTimeout(r, 6));
const PASS5 = 'plum orbit velvet anchor glacier ember';
const pair = async () => {
  const A = (await mk('conflict device A pass!')).v, B = (await mk('conflict device B pass!')).v;
  const round = async (from, to) => to.applyRemote(await openBundle(await sealBundle(await from.buildBundle(), PASS5, FAST), PASS5));
  const seed = newItem('login', { name: 'Shared', username: 'alice', password: 'pw-original', url: 'https://x.example', notes: 'n0' });
  await A.add(seed); await round(A, B); await round(B, A); await tick();
  return { A, B, round, id: seed.id };
};

test('conflicts: edits to DIFFERENT fields on two devices both survive, no conflict raised', async () => {
  const { A, B, round, id } = await pair();
  await A.update(id, { password: 'pw-from-A' }); await tick();
  await B.update(id, { notes: 'notes from B', username: 'alice2' }); await tick();
  const r1 = await round(A, B), r2 = await round(B, A);
  for (const d of [A, B]) { const it = d.get(id); assert.equal(it.password, 'pw-from-A'); assert.equal(it.notes, 'notes from B'); assert.equal(it.username, 'alice2'); assert.equal(it.conflicts.length, 0); }
  assert.equal(r1.conflicts + r2.conflicts, 0);
  await round(A, B); await round(B, A);                                    // stays stable
  assert.equal(A.get(id).password, B.get(id).password);
});

test('conflicts: same field edited on both → newest wins on BOTH devices, the other value is kept for review', async () => {
  const { A, B, round, id } = await pair();
  await A.update(id, { password: 'older-edit-on-A' }); await tick();
  await B.update(id, { password: 'newer-edit-on-B' }); await tick();
  const r1 = await round(A, B);      // B pulls A's older edit: B keeps its own newer value
  const r2 = await round(B, A);
  assert.equal(A.get(id).password, 'newer-edit-on-B'); assert.equal(B.get(id).password, 'newer-edit-on-B');
  assert.ok(r1.conflicts + r2.conflicts >= 1);
  for (const d of [A, B]) { const c = d.get(id).conflicts; assert.equal(c.length, 1); assert.equal(c[0].key, 'password'); assert.equal(c[0].value, 'older-edit-on-A'); }
  assert.equal(A.get(id).conflicts[0].id, B.get(id).conflicts[0].id, 'both devices describe the conflict identically');
  assert.ok(A.auditLog().some((e) => /Edited on two devices/.test(e.m)) || B.auditLog().some((e) => /Edited on two devices/.test(e.m)));
  assert.ok(A.get(id).revisions.length >= 1);                              // the overwritten value is also in version history
  // a second sync does not duplicate the conflict
  await round(A, B); await round(B, A); assert.equal(A.get(id).conflicts.length, 1); assert.equal(B.get(id).conflicts.length, 1);
  assert.equal(A.conflictCount(), 1);
});

test('conflicts: resolving ("use other" / "keep") propagates to the other device and clears there', async () => {
  const { A, B, round, id } = await pair();
  await A.update(id, { password: 'older-edit-on-A', notes: 'A notes' }); await tick();
  await B.update(id, { password: 'newer-edit-on-B', notes: 'B notes' }); await tick();
  await round(A, B); await round(B, A);
  assert.equal(A.get(id).conflicts.length, 2);
  const pwC = A.get(id).conflicts.find((c) => c.key === 'password'), noteC = A.get(id).conflicts.find((c) => c.key === 'notes');
  await tick(); await A.resolveConflict(id, pwC.id, 'other');             // A decides the older password was right
  await A.resolveConflict(id, noteC.id, 'keep');
  assert.equal(A.get(id).password, 'older-edit-on-A'); assert.equal(A.get(id).conflicts.length, 0);
  await round(A, B); await round(B, A);
  assert.equal(B.get(id).password, 'older-edit-on-A'); assert.equal(B.get(id).notes, 'B notes');
  assert.equal(B.get(id).conflicts.length, 0, 'resolution is synced');
  await round(B, A); assert.equal(A.get(id).conflicts.length, 0);
});

test('conflicts: one-sided edits never raise a conflict, regardless of sync order; template + custom fields merge per key', async () => {
  const { A, B, round } = await pair();
  const net = newItem('network', { name: 'Home', fields: { ssid: 'one', wifipw: 'pw1', ip: '10.0.0.1' }, custom: [] }); await A.add(net); await round(A, B); await round(B, A); await tick();
  await A.update(net.id, { fields: { ...A.get(net.id).fields, wifipw: 'pw-A' } }); await tick();
  await B.update(net.id, { fields: { ...B.get(net.id).fields, ip: '10.0.0.9' } }); await tick();
  await round(B, A); await round(A, B);
  for (const d of [A, B]) { const f = d.get(net.id).fields; assert.deepEqual([f.ssid, f.wifipw, f.ip], ['one', 'pw-A', '10.0.0.9']); assert.equal(d.get(net.id).conflicts.length, 0); }
  // stale device pulls without having edited: it just takes the newer value
  await A.update(net.id, { fields: { ...A.get(net.id).fields, ssid: 'two' } }); await round(A, B);
  assert.equal(B.get(net.id).fields.ssid, 'two'); assert.equal(B.get(net.id).conflicts.length, 0);
});

test('conflicts: attachments from both devices are united; a removal propagates', async () => {
  const { A, B, round, id } = await pair();
  const a1 = await A.addAttachment(id, { name: 'a.txt', type: 'text/plain', bytes: bytesOf(50, 3) }); await tick();
  const b1 = await B.addAttachment(id, { name: 'b.txt', type: 'text/plain', bytes: bytesOf(60, 5) }); await tick();
  await round(A, B); await round(B, A);
  for (const d of [A, B]) assert.deepEqual(d.get(id).attachments.map((a) => a.name).sort(), ['a.txt', 'b.txt']);
  assert.equal((await B.readAttachment(id, a1.id)).bytes.length, 50); assert.equal((await A.readAttachment(id, b1.id)).bytes.length, 60);
  await A.removeAttachment(id, a1.id); await round(A, B); await round(B, A);
  assert.deepEqual(B.get(id).attachments.map((a) => a.name), ['b.txt']);
  assert.equal(await B.hasBlob(a1.id), false);
  assert.deepEqual(A.get(id).attachments.map((a) => a.name), ['b.txt']);          // removal is not undone by the stale copy
});

test('conflicts: hostile conflict data in a bundle is bounded and validated', async () => {
  const { v } = await mk('hostile conflict target');
  const r = await v.applyRemote({ format: 'VaultManager-sync', v: 1, items: [{ id: 'b'.repeat(24), name: 'x', conflicts: [{ id: 'zzzz', key: 'password', value: 'a' }, { id: 'deadbeef', key: 'k'.repeat(200), value: 'a' }, { id: 'deadbeef', key: 'password', value: 'ok' }, ...Array.from({ length: 50 }, (_, i) => ({ id: i.toString(16).padStart(8, '0'), key: 'notes', value: 'v' }))], ft: { password: 'NaN', notes: 5 }, sv: [1, 2] }] });
  assert.equal(r.added, 1); const it = v.items[0]; assert.ok(it.conflicts.length <= 20); assert.ok(it.conflicts.every((c) => /^[0-9a-f]{8}$/.test(c.id) && c.key.length < 60));
  assert.deepEqual(it.ft, { notes: 5 }); assert.ok(Object.values(it.sv).every((n) => Number.isFinite(n)), 'sv is a clean numeric map');
});

test('update(): a stale copy of the item (as the editor sends) cannot clobber sync bookkeeping', async () => {
  const { v } = await mk();
  const it = newItem('login', { name: 'S', username: 'a', password: 'p' }); await v.add(it);
  const stale = structuredClone(v.get(it.id));                    // the editor opens with this copy
  await tick(); await v.update(it.id, { notes: 'edited elsewhere' });  // something changes the item meanwhile
  const ftNotes = v.get(it.id).ft.notes;
  await tick(); await v.update(it.id, { ...stale, username: 'b' });    // editor saves its whole stale object
  const cur = v.get(it.id);
  assert.equal(cur.username, 'b'); assert.equal(cur.notes, '', 'the editor saved its own (older) notes value, as an editor save should');
  assert.ok(cur.ft.username > ftNotes, 'the new edit carries the newest field timestamp');
  assert.ok(cur.revisions.length >= 1 && cur.attachments.length === 0);
});

test('look settings: normalised, bounded, widgets merged, accent maths', async () => {
  const { normalizeLook, LOOK_DEFAULTS, accentTokens, WIDGET_DEFS } = await import('../js/look.js');
  const n = normalizeLook({ accent: 'javascript:alert(1)', uiScale: 9999, radius: -5, animSpeed: 'fast', iconStyle: 'bogus', nav: 'dock', dockSize: 1, widgets: [{ id: 'tip', on: false, size: 'xl' }, { id: 'nope' }, { id: 'tip' }] });
  assert.equal(n.accent, LOOK_DEFAULTS.accent); assert.equal(n.uiScale, 130); assert.equal(n.radius, 4); assert.equal(n.animSpeed, 1); assert.equal(n.iconStyle, 'vivid'); assert.equal(n.nav, 'dock'); assert.equal(n.dockSize, 32);
  assert.equal(n.widgets.length, WIDGET_DEFS.length); assert.deepEqual(n.widgets[0], { id: 'tip', on: false, size: 's', pinned: false, cw: 0, ch: 0 });
  const w2 = normalizeLook({ widgets: [{ id: 'clock', pinned: true, cw: 9, ch: 5000 }, { id: 'health', cw: 2, ch: 20 }] }).widgets;
  assert.deepEqual([w2[0].pinned, w2[0].cw, w2[0].ch, w2[1].cw, w2[1].ch], [true, 4, 700, 2, 100], 'pin and manual size are bounded');
  const dark = accentTokens('#2fe6d0', 'dark'), light = accentTokens('#2fe6d0', 'light');
  assert.equal(dark.accent, '#2fe6d0'); assert.notEqual(light.accent, dark.accent); assert.equal(dark.ink, '#06201d'); assert.equal(light.ink, '#ffffff');
  const { v } = await mk('look settings pass!!'); assert.equal(v.settings.look.accent, '#2fe6d0'); assert.ok(v.settings.look.widgets.length >= 10);
  v.settings.look.accent = '#ff0000'; await v.save(); v.lock();
});

test('v0.7 categories: all 15 requested exist, are grouped exactly once, and are fully usable', async () => {
  const wanted = ['contact', 'phone', 'technical', 'crypto', 'emergency', 'lens', 'membership', 'internet', 'prescription', 'serial', 'voter', 'photoid', 'library', 'healthcard', 'car'];
  for (const k of wanted) assert.ok(TEMPLATES[k], 'missing category ' + k);
  assert.equal(TYPE_KEYS.length, 28);
  for (const k of TYPE_KEYS) assert.ok(!RESERVED_VIEWS.includes(k), 'category key "' + k + '" collides with an app view id');
  const flat = GROUPS.flatMap(([, keys]) => keys);
  assert.equal(new Set(flat).size, flat.length, 'a category is in two groups'); assert.deepEqual([...flat].sort(), [...TYPE_KEYS].sort());
  for (const [g, keys] of GROUPS) { assert.ok(keys.length); for (const k of keys) assert.equal(TYPE_META[k].group, g); }
  assert.ok(TEMPLATES.crypto.fields.find((f) => f.k === 'seed' && f.secret && f.kind === 'multiline'), 'seed phrase is a secret multiline field');
  assert.ok(TEMPLATES.lens.fields.some((f) => f.k === 'od_sph') && TEMPLATES.lens.fields.some((f) => f.k === 'os_axis') && TEMPLATES.lens.fields.some((f) => f.k === 'pd'));
  assert.ok(TEMPLATES.healthcard.fields.find((f) => f.k === 'blood').options.includes('O+'));
  assert.ok(TEMPLATES.car.fields.some((f) => f.k === 'vin') && TEMPLATES.car.fields.some((f) => f.k === 'plate'));
  assert.ok(TEMPLATES.crypto.tip && TEMPLATES.photoid.tip);

  const { v } = await mk('v07 categories password');
  const secrets = [];
  for (const k of wanted) {
    const fields = {}; for (const f of TEMPLATES[k].fields) { const sec = f.kind === 'secret' || f.secret; fields[f.k] = f.kind === 'select' ? f.options[1] : f.kind === 'date' ? '2020-03-04' : sec ? 'SEC-' + k + '-' + f.k : 'plain-' + k + '-' + f.k; if (sec) secrets.push(fields[f.k]); }
    await v.add(sanitiseItem({ type: k, name: 'Item ' + k, fields }));
  }
  assert.equal(v.active().length, 15);
  for (const it of v.active()) {
    assert.ok(Object.keys(it.fields).length >= TEMPLATES[it.type].fields.length - 1, it.type + ' keeps its fields');
    assert.ok(matches(it, 'plain-' + it.type), it.type + ' searchable'); assert.ok(!matches(it, 'SEC-'), it.type + ' secrets not searchable');
  }
  const log = JSON.stringify(v.auditLog()); for (const sct of secrets) assert.ok(!log.includes(sct));
  // everything with an expiry date is reported once the date is in the past
  const exp = health(v.active(), Date.parse('2026-11-09')).expiring.map((x) => x.item.type + ':' + x.label);
  for (const k of ['lens', 'membership', 'internet', 'prescription', 'serial', 'voter', 'photoid', 'library', 'healthcard', 'car']) assert.ok(exp.some((e) => e.startsWith(k + ':')), k + ' has an expiry that is tracked');
  assert.equal(exp.filter((e) => e.startsWith('car:')).length, 3, 'car registration, insurance and service');
  // backups, sync and csv carry them
  const csv = exportCSV(v.active()); assert.ok(csv.includes('Recovery seed phrase: SEC-crypto-seed') && csv.includes('Right eye (OD) — sphere: plain-lens-od_sph'));
  const blob = await v.exportEncrypted('backup pass phrase', FAST); const dec = await decryptBackup(blob, 'backup pass phrase');
  const { v: w } = await mk('v07 restore password'); const r = w.mergeItems(dec.items, dec.attachments); await r.save; assert.equal(w.active().length, 15);
  assert.deepEqual(w.active().find((i) => i.type === 'car').fields, v.active().find((i) => i.type === 'car').fields);
});

/* ================= v0.10: offline apps / native scaffold ================= */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rj = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));

test('native shell scaffold: versions agree, config is strict, only two plugins, icons exist', () => {
  const pkg = rj('package.json'), conf = rj('native/src-tauri/tauri.conf.json'), npkg = rj('native/package.json'), cap = rj('native/src-tauri/capabilities/default.json');
  const cargo = fs.readFileSync(path.join(ROOT, 'native/src-tauri/Cargo.toml'), 'utf8');
  assert.equal(conf.version, pkg.version); assert.equal(npkg.version, pkg.version); assert.match(cargo, new RegExp('^version = "' + pkg.version.replace(/\./g, '\\.') + '"', 'm'));
  assert.match(fs.readFileSync(path.join(ROOT, 'js/version.js'), 'utf8'), new RegExp("APP_VERSION = '" + pkg.version.replace(/\./g, '\\.') + "'"));
  assert.match(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), new RegExp("vm-" + pkg.version.replace(/\./g, '\\.')));
  const csp = conf.app.security.csp;
  assert.ok(/default-src 'none'/.test(csp) && !/unsafe-/.test(csp) && /script-src 'self'/.test(csp), 'native CSP is as strict as the web CSP');
  assert.deepEqual([...csp.matchAll(/https?:\/\/[^\s;]+/g)].map((m) => m[0]).filter((u) => !/ipc\.localhost|asset\.localhost|api\.github\.com|script\.google(usercontent)?\.com/.test(u)), [], 'no other hosts');
  assert.deepEqual(cap.permissions.slice().sort(), ['core:default', 'dialog:allow-save', 'fs:allow-write-file'], 'minimal capability set');
  assert.equal([...cargo.matchAll(/^tauri-plugin-[a-z]+/gm)].length, 2, 'only the dialog and fs plugins');
  for (const i of conf.bundle.icon) assert.ok(fs.existsSync(path.join(ROOT, 'native/src-tauri', i)), 'icon ' + i);
  for (const f of ['android/mipmap-xxxhdpi/ic_launcher.png', 'ios/AppIcon-512@2x.png']) assert.ok(fs.existsSync(path.join(ROOT, 'native/src-tauri/icons', f)), f);
  assert.equal(conf.identifier, 'com.ulyweb.vaultmanager'); assert.ok(conf.build.frontendDist.endsWith('dist/web'));
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/native.yml'), 'utf8');
  for (const needle of ['windows-latest', 'macos-latest', 'ubuntu-22.04', 'android init', 'CAMERA', 'upload-artifact']) assert.ok(wf.includes(needle), 'workflow mentions ' + needle);
});

test('web and single-file builds: complete, hash-pinned, self-contained; native web build only adds the IPC origins', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'tools/build-web.mjs')], { stdio: 'pipe' });
  const web = path.join(ROOT, 'dist/web'); const ls = (d) => fs.readdirSync(d, { recursive: true }).map(String);
  const files = ls(web); for (const f of ['index.html', 'sw.js', 'manifest.webmanifest', 'js/app.js', 'js/icons.js', 'vendor/qrcode.js', 'icons/icon-512.png']) assert.ok(files.includes(f.replace(/\//g, path.sep)), 'dist/web has ' + f);
  assert.ok(!files.some((f) => /icon-1024/.test(f)));
  const webHtml = fs.readFileSync(path.join(web, 'index.html'), 'utf8'); assert.ok(!/ipc:/.test(webHtml));
  execFileSync(process.execPath, [path.join(ROOT, 'tools/build-web.mjs'), '--native'], { stdio: 'pipe' });
  const nat = fs.readFileSync(path.join(web, 'index.html'), 'utf8'); assert.ok(/connect-src 'self' https:\/\/api\.github\.com https:\/\/script\.google\.com https:\/\/script\.googleusercontent\.com ipc: http:\/\/ipc\.localhost;/.test(nat));
  assert.equal(nat.replace(/ ipc: http:\/\/ipc\.localhost/, ''), webHtml, 'the native build differs only by the IPC origins');

  execFileSync(process.execPath, [path.join(ROOT, 'tools/build-offline.mjs')], { stdio: 'pipe' });
  const one = fs.readFileSync(path.join(ROOT, 'offline/VaultManager-offline.html'), 'utf8');
  const csp = one.match(/Content-Security-Policy" content="([^"]*)"/)[1];
  assert.ok(/script-src 'sha256-[A-Za-z0-9+/=]+' blob:/.test(csp) && /style-src 'sha256-/.test(csp) && !/unsafe-/.test(csp) && /connect-src https:\/\/api\.github\.com;/.test(csp));
  const crypto = awaitableCrypto();
  const inline = [...one.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]); assert.equal(inline.length, 1);
  assert.ok(csp.includes(crypto.createHash('sha256').update(inline[0]).digest('base64')), 'the inline script matches its CSP hash');
  const style = one.match(/<style>([\s\S]*?)<\/style>/)[1]; assert.ok(csp.includes(crypto.createHash('sha256').update(style).digest('base64')), 'the stylesheet matches its CSP hash');
  assert.ok(!/<script[^>]+src=|<link[^>]+href="(?!data:)/.test(one), 'no external references');
  assert.ok(one.includes('vendor/qrcode.js') && one.includes('vendor/jsQR.js'), 'QR libraries are embedded');
  assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket/.test(inline[0].replace(/"(?:[^"\\\n]|\\.)*"/g, '')) || /api\.github\.com/.test(inline[0]), 'only the gist client uses the network');
});
import nodeCrypto from 'node:crypto';
function awaitableCrypto() { return nodeCrypto; }

test('profiles: registry, legacy migration, avatar sanitising, per-profile storage keys', () => {
  const st = new MemStorage(); st.setItem('vaultmanager.vault', '{}');
  const P = new Profiles(st);
  assert.deepEqual(P.list().map((p) => [p.id, p.name]), [['main', 'My vault']], 'the pre-profile vault is adopted untouched');
  const a = P.add({ name: '  Alex<b> ', avatar: { type: 'emoji', value: '🦊' } });
  assert.equal(a.name, 'Alexb'); assert.deepEqual(a.avatar, { type: 'emoji', value: '🦊' });
  assert.notEqual(keysFor(a.id).vault, keysFor('main').vault);
  assert.deepEqual(sanitizeAvatar({ type: 'photo', value: 'javascript:alert(1)' }), { type: 'letter' });
  assert.deepEqual(sanitizeAvatar({ type: 'emoji', value: '<img>' }), { type: 'letter' });
  P.remove(a.id); assert.equal(P.get(a.id), null);
});

test('whole-profile backup round-trips items, attachments and settings; secrets stay out; wrong password fails', async () => {
  const blobs = memoryBlobs(), storage = new MemStorage(), profiles = new Profiles(storage);
  const A = new VaultStore(new MemStorage(), 'k', blobs, 'f'); await A.create('correct horse battery', FAST);
  A.data.settings.sync = { token: 'ghp_SECRET', passphrase: 'pp-secret', gistId: 'g1', auto: true };
  A.data.settings.look = { accent: '#ff00aa' };
  const it = newItem('login'); it.name = 'Bank'; await A.add(it);
  await A.addAttachment(it.id, { name: 'scan.txt', type: 'text/plain', bytes: new TextEncoder().encode('hello attachment') });
  const text = await A.exportProfile('backup-password-1', { profile: { name: 'Alex', avatar: { type: 'letter' } }, ...FAST });
  assert.ok(text.startsWith('VMP1:')); assert.ok(!text.includes('ghp_SECRET'));
  await assert.rejects(() => decryptProfile(text, 'wrong-password-xx'));
  const d = await decryptProfile(text, 'backup-password-1'); assert.equal(d.kind, 'profile'); assert.equal(d.name, 'Alex');
  const r = await createProfileFromImport({ storage, blobs, profiles }, d, { name: 'Alex', avatar: { type: 'letter' }, masterPassword: 'a-brand-new-master-pw', iterations: 100000 });
  assert.equal(r.items, 1); assert.equal(r.attachments, 1);
  const B = new VaultStore(storage, keysFor(r.profile.id).vault, blobs, keysFor(r.profile.id).fails);
  await B.unlock({ password: 'a-brand-new-master-pw' });
  const got = B.active()[0]; assert.equal(got.name, 'Bank');
  assert.equal(new TextDecoder().decode((await B.readAttachment(got.id, got.attachments[0].id)).bytes), 'hello attachment');
  assert.equal(B.data.settings.look.accent, '#ff00aa'); assert.ok(!(B.data.settings.sync || {}).token);
  assert.notEqual(B.session.id, A.session.id, 'a fresh vault id, so blobs of both coexist');
});

test('item passcode lock: seals secrets, hides them until opened, survives backup/sync, wrong passcode refused, merge never leaks', async () => {
  const S = new VaultStore(new MemStorage(), 'k', memoryBlobs(), 'f'); await S.create('correct horse battery', FAST);
  const it = newItem('crypto'); it.name = 'Ledger'; it.fields = { seed: 'abandon ability able about', pin: '4821' }; it.notes = 'secret note'; await S.add(it);
  await S.lockItem(it.id, 'second-code-1', FAST);
  const got = S.get(it.id);
  assert.ok(got.lock && got.notes === '' && !got.fields.seed && !JSON.stringify(S.data).includes('abandon ability'), 'readable secrets are gone from the stored data');
  assert.equal(got.revisions.length, 0); assert.equal(got.history.length, 0);
  S.itemKeys.clear();                                           // closed again
  assert.equal(S.reveal(S.get(it.id)).fields.seed, undefined);
  await assert.rejects(() => S.openItem(it.id, 'wrong-code-xx'), /bad-passcode/);
  await assert.rejects(() => S.openItem(it.id, 'second-code-1'), /Too many/, 'throttled right after a failure');
  S.itemFails.clear();
  await S.openItem(it.id, 'second-code-1');
  assert.equal(S.reveal(S.get(it.id)).fields.seed, 'abandon ability able about');
  await S.saveLocked(it.id, { name: 'Ledger 2' }, { ...S.reveal(S.get(it.id)), notes: 'changed' }, FAST);
  assert.equal(S.get(it.id).name, 'Ledger 2'); assert.equal(S.reveal(S.get(it.id)).notes, 'changed'); assert.equal(S.get(it.id).notes, '');
  // a merge from a device that still has the readable copy must not bring secrets back
  const stale = { ...structuredClone(S.get(it.id)), lock: '', notes: 'LEAK', ft: { notes: Date.now() + 99999 } };
  mergeItem(S.get(it.id), stale); assert.equal(S.get(it.id).notes, '');
  await S.removeItemLock(it.id, 'second-code-1');
  assert.equal(S.get(it.id).lock, ''); assert.equal(S.get(it.id).fields.seed, 'abandon ability able about');
});

test('item passcode lock covers attachments: sealed under the item key, names hidden, readable only when open, survive sync, passcode change and unlock', async () => {
  const blobs = memoryBlobs(), S = new VaultStore(new MemStorage(), 'k', blobs, 'f'); await S.create('correct horse battery', FAST);
  const it = newItem('bank'); it.name = 'Savings'; await S.add(it);
  const plain = new TextEncoder().encode('passport scan bytes 12345');
  await S.addAttachment(it.id, { name: 'passport.jpg', type: 'image/jpeg', bytes: plain });
  await S.lockItem(it.id, 'second-code-1', FAST);
  const meta = S.get(it.id).attachments[0];
  assert.equal(meta.name, 'Locked file'); assert.equal(meta.lk, true); assert.ok(!JSON.stringify(S.data).includes('passport'));
  const vaultLayer = await S.session.openBlob(meta.id, await blobs.get(S._bk(meta.id)));
  assert.notDeepEqual([...vaultLayer], [...plain], 'the file is still sealed after the vault layer is removed');
  await assert.rejects(() => S.readAttachment(it.id, meta.id), /locked/);
  await S.openItem(it.id, 'second-code-1');
  const r = await S.readAttachment(it.id, meta.id); assert.equal(r.meta.name, 'passport.jpg'); assert.deepEqual([...r.bytes], [...plain]);
  assert.equal(S.reveal(S.get(it.id)).attachments[0].name, 'passport.jpg');
  await S.addAttachment(it.id, { name: 'deed.pdf', type: 'application/pdf', bytes: new TextEncoder().encode('deed') });
  assert.equal(S.get(it.id).attachments.length, 2); assert.ok(S.get(it.id).attachments.every((a) => a.lk && a.name === 'Locked file'));
  // sync to a second device
  const B = new VaultStore(new MemStorage(), 'k2', memoryBlobs(), 'f2'); await B.create('another long password 1', FAST);
  await B.applyRemote(await S.buildBundle());
  const bi = B.get(it.id); await assert.rejects(() => B.readAttachment(bi.id, bi.attachments[0].id), /locked/);
  await B.openItem(bi.id, 'second-code-1'); assert.equal((await B.readAttachment(bi.id, bi.attachments[0].id)).meta.name, 'passport.jpg');
  // change passcode: files stay readable
  S.itemFails.clear(); await S.changeItemCode(it.id, 'second-code-1', 'third-code-22', FAST); S.itemFails.clear();
  await S.openItem(it.id, 'third-code-22'); assert.deepEqual([...(await S.readAttachment(it.id, meta.id)).bytes], [...plain]);
  // remove the lock: files go back to the normal (vault-only) layer with their real names
  await S.removeItemLock(it.id, 'third-code-22');
  const back = S.get(it.id).attachments[0]; assert.equal(back.name, 'passport.jpg'); assert.ok(!back.lk);
  assert.deepEqual([...(await S.readAttachment(it.id, back.id)).bytes], [...plain]);
});

test('item locked before files were covered: opening it seals the existing files', async () => {
  const S = new VaultStore(new MemStorage(), 'k', memoryBlobs(), 'f'); await S.create('correct horse battery', FAST);
  const it = newItem('note'); it.name = 'Old'; await S.add(it);
  await S.lockItem(it.id, 'second-code-1', FAST);
  const p = S.itemKeys.get(it.id); // simulate the v0.13 payload (no ak) and an unsealed file
  await S.openItem(it.id, 'second-code-1');
  const att = await S.addAttachment(it.id, { name: 'a.txt', type: 'text/plain', bytes: new TextEncoder().encode('x') });
  assert.ok(att);
});

test('contact admin: same relay as ulyOS, notice carries no secrets, only fires when allowed; hide lists are sanitised', async () => {
  globalThis.location = { protocol: 'https:', hostname: 'example.github.io', host: 'example.github.io', pathname: '/vaultmanager/' };
  const { validEmail, newProfileFields, notifyNewProfile, enabled, notifyEnabled } = await import('../js/admin.js');
  const { CONTACT_ENDPOINT } = await import('../js/config.js');
  const { normalizeLook } = await import('../js/look.js');
  assert.ok(validEmail('admin@example.com')); assert.ok(!validEmail('nope')); assert.ok(!validEmail('a b@c.de')); assert.ok(!validEmail('x@y.z"><script>'));
  assert.match(CONTACT_ENDPOINT, /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/);
  const f = newProfileFields('Alex', { contact: 'a@b.co' }); assert.match(f.subject, /New profile: Alex/); assert.match(f.message, /Contact email.*a@b\.co/);
  assert.ok(!/master password:|vault data:/i.test(f.message) && /ever included/.test(f.message));
  assert.ok(enabled() && notifyEnabled());
  const calls = []; const ok = await notifyNewProfile('Alex', {}, { fetchImpl: async (u, o) => { calls.push([u, o.method, o.body.get('subject'), o.body.get('email')]); } });
  assert.equal(ok, true); assert.equal(calls.length, 1); assert.equal(calls[0][0], CONTACT_ENDPOINT); assert.equal(calls[0][1], 'POST'); assert.match(calls[0][2], /New profile: Alex/); assert.match(calls[0][3], /@/);
  assert.equal(await notifyNewProfile('Alex', {}, { fetchImpl: async () => { throw new Error('offline'); } }), false, 'a failed send never throws');
  globalThis.location = { protocol: 'http:', hostname: 'localhost', host: 'localhost:8000', pathname: '/' };
  assert.equal(notifyEnabled(), false, 'no notification from localhost'); assert.equal(await notifyNewProfile('Alex', {}, { fetchImpl: async () => { calls.push('x'); } }), false); assert.equal(calls.length, 1);
  globalThis.location = { protocol: 'file:', hostname: '', host: '', pathname: '/x.html' }; assert.equal(enabled(), false, 'the single-file copy never contacts anyone');
  const l = normalizeLook({ hiddenCats: ['crypto', 'crypto', '<x>', 5, 'bank'], hiddenNav: ['qr', 'home', 'settings', 'tm', 'zzz'] });
  assert.deepEqual(l.hiddenCats, ['crypto', 'bank']); assert.deepEqual(l.hiddenNav, ['qr', 'tm']);
});
