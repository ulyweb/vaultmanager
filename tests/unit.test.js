import test from 'node:test';
import assert from 'node:assert/strict';
import { runSelfTest } from '../js/selftest.js';
import { generatePassword, generatePassphrase, generatePin, passwordEntropy, passphraseEntropy } from '../js/generator.js';
import { estimate } from '../js/strength.js';
import { VaultStore, importCSV, importBitwardenJSON, exportCSV, health, decryptBackup, newItem, matches, parseCSV } from '../js/vault.js';
import { chunkPayload, ChunkAssembler, parseChunk } from '../js/qr.js';
import { parseTotp } from '../js/totp.js';
import { memoryBlobs } from '../js/blobs.js';
import { sealBundle, openBundle, GistClient, syncGist, exportSyncFile, importSyncFile } from '../js/sync.js';
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
