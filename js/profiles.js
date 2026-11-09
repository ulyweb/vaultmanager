/* Profiles — several people (or several vaults) on one device, like the ulyOS sign-in screen.

   Each profile is a completely separate vault: its own master password, its own encrypted record, attachments,
   settings and audit trail. Only the *registry* — name, picture, last-used time — is stored outside the vault
   (the sign-in screen has to show it before anything can be decrypted), so keep nothing sensitive in a name.

   The vault that existed before profiles were introduced keeps its original storage keys and appears as the
   profile "My vault" (id "main"), so nothing has to be moved or re-encrypted. */

import { VaultStore } from './vault.js';

export const REG_KEY = 'vaultmanager.profiles';
export const LAST_KEY = 'vaultmanager.profile.last';
export const LEGACY_ID = 'main';

export const keysFor = (id) => (id === LEGACY_ID
  ? { vault: 'vaultmanager.vault', fails: 'vaultmanager.fails', look: 'vaultmanager.look' }
  : { vault: 'vaultmanager.vault.' + id, fails: 'vaultmanager.fails.' + id, look: 'vaultmanager.look.' + id });

export const newProfileId = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('');

const PHOTO = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
export function sanitizeAvatar(a) {
  if (!a || typeof a !== 'object') return { type: 'letter' };
  if (a.type === 'emoji' && typeof a.value === 'string' && a.value.length > 0 && a.value.length <= 16 && !/[<>&"'\\]/.test(a.value)) return { type: 'emoji', value: a.value };
  if (a.type === 'photo' && typeof a.value === 'string' && a.value.length <= 160000 && PHOTO.test(a.value)) return { type: 'photo', value: a.value };
  return { type: 'letter' };
}

export function sanitizeProfile(p) {
  if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !/^[0-9a-f]{8}$|^main$/.test(p.id)) return null;
  const name = String(p.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40) || 'Profile';
  return { id: p.id, name, avatar: sanitizeAvatar(p.avatar), created: Number(p.created) || 0, last: Number(p.last) || 0 };
}

export class Profiles {
  constructor(storage) { this.storage = storage; }

  _read() {
    let raw = null;
    try { raw = JSON.parse(this.storage.getItem(REG_KEY)); } catch { raw = null; }
    if (Array.isArray(raw)) return raw.map(sanitizeProfile).filter(Boolean);
    // first run with profiles: adopt the pre-profile vault, if there is one
    if (this.storage.getItem(keysFor(LEGACY_ID).vault)) { const list = [{ id: LEGACY_ID, name: 'My vault', avatar: { type: 'letter' }, created: Date.now(), last: Date.now() }]; this._write(list); return list; }
    return [];
  }
  _write(list) { this.storage.setItem(REG_KEY, JSON.stringify(list)); }

  list() { return this._read().sort((a, b) => (b.last || 0) - (a.last || 0) || a.name.localeCompare(b.name)); }
  get(id) { return this._read().find((p) => p.id === id) || null; }
  last() { try { const id = this.storage.getItem(LAST_KEY); return this.get(id) || this.list()[0] || null; } catch { return this.list()[0] || null; } }
  setLast(id) { try { this.storage.setItem(LAST_KEY, id); } catch { /* ignore */ } this.update(id, { last: Date.now() }); }

  add({ id = newProfileId(), name, avatar }) {
    const list = this._read(); if (list.some((p) => p.id === id)) throw new Error('That profile already exists.');
    const p = sanitizeProfile({ id, name, avatar, created: Date.now(), last: Date.now() }); if (!p) throw new Error('Invalid profile.');
    list.push(p); this._write(list); return p;
  }
  update(id, patch) {
    const list = this._read(), i = list.findIndex((p) => p.id === id); if (i < 0) return null;
    list[i] = sanitizeProfile({ ...list[i], ...patch, id }); this._write(list); return list[i];
  }
  remove(id) {
    this._write(this._read().filter((p) => p.id !== id));
    try { if (this.storage.getItem(LAST_KEY) === id) this.storage.removeItem(LAST_KEY); } catch { /* ignore */ }
    const k = keysFor(id); try { this.storage.removeItem(k.look); } catch { /* ignore */ }
  }
}

/* Create a brand-new profile from a decrypted backup (see decryptProfile in vault.js).
   env = { storage, blobs, profiles }. The backup's data is sealed under the NEW master password. */
export async function createProfileFromImport(env, data, { name, avatar, masterPassword, iterations }) {
  const id = newProfileId(), k = keysFor(id);
  const st = new VaultStore(env.storage, k.vault, env.blobs, k.fails);
  try {
    await st.create(masterPassword, iterations ? { iterations } : {});
    if (data.kind === 'profile') await st.restoreProfileData(data);
    else { const r = st.mergeItems(data.items, data.attachments || {}); await r.save; }
    if (!(st.data.settings.displayName || '').trim()) st.data.settings.displayName = name;
    st.data.settings.tourSeen = true;
    await st.save();
  } catch (e) { await st.wipe(); throw e; }
  const items = st.active().length, attachments = (await st.attachmentStats()).count;
  st.lock();
  const profile = env.profiles.add({ id, name, avatar });
  return { profile, items, attachments };
}
