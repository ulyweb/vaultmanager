/* The downloadable single-file copy (VaultManager-offline.html). It is built from the same source, committed in
   offline/, served next to the app, and verified against its SHA-256 before it is handed to you.
   This module only ever requests files from the app's own address (no other host). */

import { download, toast } from './dom.js';

export const isSingleFile = () => location.protocol === 'file:';
export const canOfferCopy = () => !isSingleFile() && !window.__TAURI__;

const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const FILE = 'offline/VaultManager-offline.html';

export async function fetchOfflineCopy() {
  let a, b;
  try { [a, b] = await Promise.all([fetch(FILE, { cache: 'no-store' }), fetch(FILE + '.sha256', { cache: 'no-store' })]); } catch { throw new Error('Could not read the offline copy (are you offline and was the app not fully cached yet?).'); }
  if (!a.ok || !b.ok) throw new Error('The offline copy is not published at this address. Download offline/VaultManager-offline.html from the project page instead.');
  const bytes = new Uint8Array(await a.arrayBuffer());
  const want = (await b.text()).trim().split(/\s+/)[0], got = hex(await crypto.subtle.digest('SHA-256', bytes));
  if (!/^[0-9a-f]{64}$/.test(want) || got !== want) throw new Error('The downloaded copy failed its checksum check, so it was NOT saved. Try again.');
  return { bytes, digest: got };
}

/* Verifies, then saves "VaultManager-offline.html". Resolves to the SHA-256 digest. */
export async function saveOfflineCopy() {
  const { bytes, digest } = await fetchOfflineCopy();
  download('VaultManager-offline.html', bytes, 'text/html');
  toast('VaultManager-offline.html saved — checksum ' + digest.slice(0, 12) + '… verified', 'ok', 6000);
  return digest;
}
