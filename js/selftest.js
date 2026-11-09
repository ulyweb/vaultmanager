/* Known-answer self-tests. Run in Node by the test-suite and in the browser from Settings → Self-test,
   so a user can verify that *their* browser's crypto matches published vectors. */

import { pbkdf2Bits, sealText, openText, createVault, openVault, recoveryEncode, recoveryDecode } from './crypto.js';
import { hotp, base32Decode, totpNow } from './totp.js';
import { generatePassword, randInt } from './generator.js';
import { b64, te } from './util.js';

const hex = (u8) => Array.from(u8, (x) => x.toString(16).padStart(2, '0')).join('');
const ascii = (s) => te.encode(s);

export async function runSelfTest(onProgress = () => {}) {
  const T = [];
  const t = (name, fn) => T.push([name, fn]);

  t('PBKDF2-HMAC-SHA256 known answer (RFC 7914 §11, 1 round)', async () => hex(await pbkdf2Bits('password', ascii('salt'), 1)) === '120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b');
  t('PBKDF2-HMAC-SHA256 known answer (2 rounds)', async () => hex(await pbkdf2Bits('password', ascii('salt'), 2)) === 'ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43');
  t('HOTP known answers (RFC 4226 Appendix D)', async () => {
    const k = ascii('12345678901234567890');
    const exp = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    for (let i = 0; i < exp.length; i++) if ((await hotp(k, i)) !== exp[i]) return false;
    return true;
  });
  t('TOTP known answers (RFC 6238, SHA-1 / 256 / 512, 8 digits)', async () => {
    const k1 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', k256 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA', k512 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA';
    const cases = [[59, k1, 'SHA1', '94287082'], [59, k256, 'SHA256', '46119246'], [59, k512, 'SHA512', '90693936'], [1111111109, k1, 'SHA1', '07081804'], [20000000000, k1, 'SHA1', '65353130']];
    for (const [s, key, algo, want] of cases) {
      const r = await totpNow({ secret: key, digits: 8, period: 30, algo }, s * 1000);
      if (r.code !== want) return false;
    }
    return true;
  });
  t('Base32 decoding', async () => hex(base32Decode('MZXW6YTBOI======')) === '666f6f626172');
  t('QR payload: seal → open round trip, wrong password rejected', async () => {
    const p = await sealText('héllo ✓ wörld', 'correct horse', { iterations: 100000 });
    if ((await openText(p, 'correct horse')) !== 'héllo ✓ wörld') return false;
    try { await openText(p, 'wrong'); return false; } catch { /* expected */ }
    return true;
  });
  t('QR payload: tampering is detected (GCM tag + authenticated header)', async () => {
    const p = b64.dec(await sealText('secret', 'pw', { iterations: 100000 }));
    for (const idx of [0, 2, 10, 40, p.length - 1]) {
      const q = p.slice(); q[idx] ^= 1;
      try { await openText(b64.enc(q), 'pw'); return false; } catch { /* expected */ }
    }
    return true;
  });
  t('Vault: create → open with password, wrong password rejected, fresh IV per write', async () => {
    const { session, record } = await createVault('a long master password', { items: [1, 2, 3] }, { iterations: 100000 });
    const again = await session.seal({ items: [1, 2, 3] });
    if (again.iv === record.iv || again.ct === record.ct) return false;
    const o = await openVault(record, { password: 'a long master password' });
    if (JSON.stringify(o.data) !== '{"items":[1,2,3]}') return false;
    try { await openVault(record, { password: 'nope' }); return false; } catch (e) { if (e.message !== 'bad-secret') return false; }
    return true;
  });
  t('Vault: recovery key opens the vault; password change keeps data readable', async () => {
    const { session, record } = await createVault('first password!', { n: 1 }, { iterations: 100000 });
    const rk = await session.createRecovery();
    await session.changePassword('second password!', 100000);
    const rec2 = await session.seal({ n: 1 });
    if ((await openVault(rec2, { recovery: rk })).data.n !== 1) return false;
    if ((await openVault(rec2, { password: 'second password!' })).data.n !== 1) return false;
    try { await openVault(rec2, { password: 'first password!' }); return false; } catch { /* expected */ }
    try { await openVault(record, { password: 'second password!' }); return false; } catch { /* expected */ }
    return true;
  });
  t('Recovery key encoding round trip', async () => {
    const b = crypto.getRandomValues(new Uint8Array(32));
    const s = recoveryEncode(b);
    return s.length === 52 + 12 && hex(recoveryDecode(s)) === hex(b) && hex(recoveryDecode(s.toLowerCase().replace(/-/g, ' '))) === hex(b);
  });
  t('Random generator: unbiased range and requested composition', async () => {
    const counts = new Array(7).fill(0);
    for (let i = 0; i < 7000; i++) counts[randInt(7)]++;
    if (counts.some((c) => c < 800 || c > 1200)) return false;
    for (let i = 0; i < 50; i++) { const p = generatePassword({ length: 12 }); if (!/[a-z]/.test(p) || !/[A-Z]/.test(p) || !/\d/.test(p) || !/[^A-Za-z0-9]/.test(p) || p.length !== 12) return false; }
    return true;
  });

  const results = [];
  for (let i = 0; i < T.length; i++) {
    const [name, fn] = T[i];
    let ok = false, err = '';
    try { ok = !!(await fn()); } catch (e) { err = e.message; }
    results.push({ name, ok, err });
    onProgress((i + 1) / T.length, name, ok);
  }
  return results;
}
