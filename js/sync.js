/* Encrypted sync. The only module allowed to touch the network, and only api.github.com, and only
   when the user has turned on gist sync. What leaves the device is ciphertext:

     bundle  = { items, tombstones, attachments } as JSON
     payload = "VMS1:" + QR-Seal-v2 style seal (PBKDF2-SHA256 600k → AES-256-GCM) under the *sync passphrase*

   The sync passphrase is separate from the master password (so devices may use different master
   passwords). It and the GitHub token live only inside the encrypted vault.
   Merge: per item the newest edit wins; deletions propagate as tombstones (kept 90 days). */

import { sealText, openText } from './crypto.js';

export const PREFIX = 'VMS1:';
const API = 'https://api.github.com';
const CHUNK = 450000;            // characters per gist file (the API truncates files above ~1 MB)
const MAX_PAYLOAD = 24 * 1048576;

export async function sealBundle(bundle, passphrase, opt = {}) {
  const payload = PREFIX + (await sealText(JSON.stringify(bundle), passphrase, opt));
  if (payload.length > MAX_PAYLOAD) throw new Error('The sync bundle is ' + (payload.length / 1048576).toFixed(1) + ' MB — too large. Turn off “sync attachments” or remove large files.');
  return payload;
}

export async function openBundle(text, passphrase) {
  const t = String(text).trim();
  if (!t.startsWith(PREFIX)) throw new Error('This is not a VaultManager sync file (it should start with VMS1:).');
  let raw;
  try { raw = await openText(t.slice(PREFIX.length), passphrase); } catch { throw new Error('Wrong sync passphrase, or the sync data was damaged or tampered with.'); }
  return JSON.parse(raw);
}

/* ---------- GitHub gist transport ---------- */
const README = 'This secret gist is an encrypted VaultManager sync bundle. It is ciphertext: without the sync passphrase it is unreadable. Do not edit these files.';

export class GistClient {
  constructor(token, fetchImpl) { this.token = token; this.f = fetchImpl || ((...a) => fetch(...a)); }

  async _req(method, url, body) {
    let res;
    try {
      res = await this.f(API + url, { method, headers: { Authorization: 'Bearer ' + this.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    } catch { throw new Error('Could not reach GitHub (offline, or a network policy blocks api.github.com).'); }
    if (res.status === 401) throw new Error('GitHub rejected the token. Create a new one with only the “gist” permission.');
    if (res.status === 404) throw new Error('Gist not found, or the token has no access to it.');
    if (res.status === 403 || res.status === 429) throw new Error('GitHub refused the request (rate limit or missing “gist” permission).');
    if (res.status === 422) throw new Error('GitHub rejected the data (too large or invalid).');
    if (!res.ok) throw new Error('GitHub error ' + res.status + '.');
    return res.json();
  }

  static files(payload) {
    const parts = Math.max(1, Math.ceil(payload.length / CHUNK));
    const files = { 'README.txt': { content: README }, 'vm-meta.json': { content: JSON.stringify({ format: 'VaultManager-sync', v: 1, parts, chars: payload.length, at: Date.now() }) } };
    for (let i = 0; i < parts; i++) files['vm-' + String(i + 1).padStart(4, '0') + '.txt'] = { content: payload.slice(i * CHUNK, (i + 1) * CHUNK) };
    return files;
  }

  async create(payload) {
    const g = await this._req('POST', '/gists', { description: 'VaultManager encrypted sync (ciphertext only)', public: false, files: GistClient.files(payload) });
    return g.id;
  }

  async read(id) {
    const g = await this._req('GET', '/gists/' + encodeURIComponent(id));
    const f = g.files || {};
    if (!f['vm-meta.json']) throw new Error('That gist is not a VaultManager sync gist.');
    const meta = JSON.parse(f['vm-meta.json'].content);
    let out = '';
    for (let i = 1; i <= meta.parts; i++) {
      const part = f['vm-' + String(i).padStart(4, '0') + '.txt'];
      if (!part || part.truncated) throw new Error('The sync gist is incomplete or too large to read (part ' + i + ').');
      out += part.content;
    }
    if (out.length !== meta.chars) throw new Error('The sync gist is incomplete (size mismatch).');
    return { payload: out, at: meta.at };
  }

  async update(id, payload, previousParts) {
    const files = GistClient.files(payload);
    for (let i = 1; i <= previousParts; i++) { const n = 'vm-' + String(i).padStart(4, '0') + '.txt'; if (!files[n]) files[n] = null; }
    await this._req('PATCH', '/gists/' + encodeURIComponent(id), { files });
  }
}

/* ---------- orchestration ---------- */
export function validateSyncPassphrase(pw, estimateFn) {
  if (!pw || pw.length < 12) return 'Use at least 12 characters for the sync passphrase.';
  if (estimateFn(pw).bits < 50) return 'That sync passphrase is too easy to guess. Use 5+ random words.';
  return '';
}

/* One full round for the gist method: pull → merge → push. Returns a summary. */
export async function syncGist(store, { fetchImpl } = {}) {
  const cfg = store.settings.sync;
  if (!cfg.token) throw new Error('Add a GitHub token first.');
  if (!cfg.passphrase) throw new Error('Set a sync passphrase first.');
  const client = new GistClient(cfg.token, fetchImpl);
  const summary = { pulled: null, pushed: false, gistId: cfg.gistId };
  let previousParts = 0;
  if (cfg.gistId) {
    const remote = await client.read(cfg.gistId);
    previousParts = Math.ceil(remote.payload.length / CHUNK);
    const bundle = await openBundle(remote.payload, cfg.passphrase);   // wrong passphrase → throws before anything is overwritten
    summary.pulled = await store.applyRemote(bundle);
  }
  const payload = await sealBundle(await store.buildBundle({ withAttachments: cfg.attachments }), cfg.passphrase);
  if (cfg.gistId) await client.update(cfg.gistId, payload, previousParts);
  else { cfg.gistId = await client.create(payload); summary.gistId = cfg.gistId; store.log('sync', 'Created a secret sync gist'); }
  summary.pushed = true;
  cfg.last = { at: Date.now(), ok: true, msg: summary.pulled ? `${summary.pulled.added} added, ${summary.pulled.updated} updated, ${summary.pulled.removed} removed` : 'First upload' };
  store.log('sync', 'Gist sync completed — ' + cfg.last.msg);
  await store.save();
  return summary;
}

/* File method: build a .vmsync payload, or merge one that was chosen by the user. */
export async function exportSyncFile(store, passphrase) {
  const cfg = store.settings.sync;
  store.log('sync', 'Exported an encrypted sync file');
  return sealBundle(await store.buildBundle({ withAttachments: cfg.attachments }), passphrase);
}
export async function importSyncFile(store, text, passphrase) {
  const bundle = await openBundle(text, passphrase);
  const res = await store.applyRemote(bundle);
  store.log('sync', 'Imported a sync file');
  return res;
}
