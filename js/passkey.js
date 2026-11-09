/* WebAuthn passkey unlock using the PRF extension (hmac-secret). Browser-only glue; the crypto that
   consumes the PRF output lives in crypto.js (Session.addPasskey / openVault).

   Needs HTTPS or localhost and an authenticator with PRF support: Windows Hello, Touch ID / iCloud
   Keychain, Android, Chrome / Edge 116+, Safari 18+, or a FIDO2 security key with hmac-secret.
   The credential's relying-party id is the site's hostname, so passkeys belong to ONE origin: a passkey
   made on one address will not appear on another (e.g. a test site vs. the final app). The master
   password always remains as the fallback. */

import { b64, te } from './util.js';
import { rand } from './crypto.js';

export const supported = () => !!(window.isSecureContext && window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);

const toUrl = (u8) => b64.enc(u8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const bytes = (buf) => new Uint8Array(buf);

const explain = (e) => {
  if (e && e.name === 'NotAllowedError') return new Error('The passkey prompt was cancelled or timed out.');
  if (e && e.name === 'InvalidStateError') return new Error('This authenticator already has a passkey for VaultManager here.');
  if (e && e.name === 'SecurityError') return new Error('Passkeys need HTTPS (or localhost) and cannot be used from this address.');
  return e instanceof Error ? e : new Error(String(e));
};

/* Create a credential and read its PRF secret. Returns { cred, salt, prf } (cred / salt base64, prf bytes). */
export async function enroll(label, vaultId) {
  if (!supported()) throw new Error('This browser or address does not support passkeys (use HTTPS or localhost, and a recent browser).');
  const salt = rand(32);
  let cred;
  try {
    cred = await navigator.credentials.create({ publicKey: {
      rp: { name: 'VaultManager', id: location.hostname },
      user: { id: te.encode('vm-' + vaultId), name: 'vaultmanager-' + vaultId.slice(0, 6), displayName: 'VaultManager (' + (label || 'this device') + ')' },
      challenge: rand(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      timeout: 120000, attestation: 'none',
      extensions: { prf: { eval: { first: salt } } },
    } });
  } catch (e) { throw explain(e); }
  const ext = cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
  if (!ext.prf || !ext.prf.enabled) throw new Error('This authenticator or browser does not support the PRF extension needed for passkey unlock (Chrome / Edge 116+, Safari 18+, Windows Hello, Touch ID, Android, or a FIDO2 key with hmac-secret). Your master password still works.');
  let prf = ext.prf.results && ext.prf.results.first ? bytes(ext.prf.results.first) : null;
  const id = bytes(cred.rawId);
  if (!prf) {   // many authenticators only return the secret on an assertion
    const a = await assertRaw([{ id, salt }]);
    prf = a.prf;
  }
  if (!prf || prf.length < 32) throw new Error('The authenticator did not return a usable secret.');
  return { cred: b64.enc(id), salt: b64.enc(salt), prf };
}

async function assertRaw(list) {
  let a;
  try {
    a = await navigator.credentials.get({ publicKey: {
      rpId: location.hostname, challenge: rand(32), userVerification: 'required', timeout: 120000,
      allowCredentials: list.map((c) => ({ type: 'public-key', id: c.id })),
      extensions: { prf: { evalByCredential: Object.fromEntries(list.map((c) => [toUrl(c.id), { first: c.salt }])) } },
    } });
  } catch (e) { throw explain(e); }
  const res = a.getClientExtensionResults ? a.getClientExtensionResults() : {};
  if (!res.prf || !res.prf.results || !res.prf.results.first) throw new Error('The authenticator did not return the passkey secret.');
  return { id: bytes(a.rawId), prf: bytes(res.prf.results.first) };
}

/* Ask the user to authenticate with any of the vault's passkeys. wraps = vault passkey wraps.
   Returns { cred, prf } ready for store.unlock({ passkey }). */
export async function authenticate(wraps) {
  if (!supported()) throw new Error('Passkeys are not available in this browser or address.');
  const list = wraps.map((w) => ({ id: b64.dec(w.cred), salt: b64.dec(w.prf) }));
  const r = await assertRaw(list);
  return { cred: b64.enc(r.id), prf: r.prf };
}
