/* "How secure is this, honestly?" — a plain-language explanation of what protects the data, how a browser app compares with a native one,
   and what nobody can promise. Every claim here is something a person can check (see "Check it yourself") or something SECURITY.md documents.
   It deliberately does NOT say "guaranteed" or "audited": no software can honestly promise the first, and this has not had the second. */

import { h, modal } from './dom.js';

export const TRUST = {
  protects: [
    ['Real, standard encryption', 'Everything is sealed with AES-256-GCM, the same standard banks and governments use. It is done by your browser’s built-in crypto engine (WebCrypto, the same code that protects HTTPS), not by home-made maths.'],
    ['A slowed-down password', 'Your master password is stretched with PBKDF2-SHA256 (600,000 rounds) before it can unlock anything, and it is never stored or sent anywhere.'],
    ['No server, no account, no tracking', 'There is nothing to hack on our side because there is no “our side”. The page’s security policy blocks every network connection except two optional ones: GitHub backup sync and the contact-admin note.'],
    ['Plain, readable code', 'The source is public on GitHub, so anyone can read it. The app never builds web pages out of your data and refuses to run inside someone else’s page.'],
    ['Tested on every change', 'Automated tests (the maths itself, plus real browsers: Chrome, Firefox and Safari engines) run on every change, and the code has been reviewed for known web-app mistakes.'],
    ['One file you can lock in place', 'The offline copy is a single file with a SHA-256 checksum, so you can confirm it is exactly the file that was published. It cannot change under you.'],
  ],
  compare: [
    ['Same cryptography', 'In a browser app the encryption itself is done by native code inside the browser. The JavaScript only asks for it. A Rust app normally also leans on well-tested crypto libraries rather than writing its own, so the part that matters most is comparable.'],
    ['Strong sandbox', 'Browsers keep each site in a locked box, away from your files and other sites, and this app adds a strict policy on top.'],
    ['Honest trade-offs', 'Native apps can wipe memory more reliably, and are not exposed to browser extensions the same way. A browser extension can see and change the pages you open, so an extension you do not fully trust can read an unlocked vault. That is why we recommend turning off all browser extensions (or using a clean browser profile with none installed) whenever you use this tool. A hosted web app also receives updates from its host (GitHub), so a compromised publisher account could ship bad code; the offline file with its checksum avoids that.'],
    ['Built for offline and air-gapped use', 'This tool was created to be used completely offline: run from the single offline file on a USB drive, on a computer that is disconnected from the internet (air-gapped), with extensions off. That is the most secure way to use it, because with no network and no extensions there is nothing that can reach your vault from outside. The online site exists so friends and testers can try it remotely; the offline, air-gapped copy is the intended way to protect real secrets.']
  ],
  limits: [
    'Nobody can honestly guarantee that any software is perfectly secure, and this does not. It was built by one person with AI help, tested heavily, and has not been audited by an independent security firm.',
    'It cannot protect you from malware or a keylogger on your device, a malicious browser extension, someone watching your screen, or a weak or reused master password. Use a long passphrase.',
    'There is no password reset. If you forget the master password and lose the recovery key, the data cannot be recovered by anyone. Keep an encrypted backup.',
    'Until you trust it, start with logins you can afford to rotate, and keep your old password manager as a backup.',
    'For the strongest protection, use the offline file on an air-gapped computer with all browser extensions turned off.',
  ],
  check: [
    'Open your browser’s developer tools, choose the Network tab and use the app: nothing is sent while you work.',
    'Use “View page source”, or read the code on GitHub: it is ordinary, unobfuscated JavaScript.',
    'Download the offline copy and compare its SHA-256 checksum with the .sha256 file next to it.',
    'Turn off your internet connection and keep using it: everything still works.',
  ],
};

export function trustBody() {
  const sec = (title, items, ordered) => h('div', { class: 'trustsec' }, h('h3', { text: title }), h(ordered ? 'ol' : 'ul', { class: 'trustlist' }, items.map((it) => (Array.isArray(it) ? h('li', null, h('b', { text: it[0] + '. ' }), it[1]) : h('li', { text: it })))));
  return h('div', { class: 'trustdoc' },
    h('p', { class: 'hint', text: 'Short answer: it is built on standard, well-tested encryption and keeps everything on your device. But “guaranteed” is not a word any honest security person uses, so here is exactly what it does, what it does not, and how you can check for yourself.' }),
    sec('What protects your data', TRUST.protects), sec('Is a browser app as serious as a native (Rust) app?', TRUST.compare),
    sec('What nobody can promise', TRUST.limits), sec('Check it yourself', TRUST.check, true));
}

/* Settings → About → FAQ: short answers, the first one is the full honest security explanation */
export const FAQ = [
  ['Where is my data stored?', 'Only on this device, inside your browser’s storage, encrypted. There is no server and no account. Clearing the browser’s site data deletes the vault, so export an encrypted backup (Import & export) and keep it somewhere safe.'],
  ['What if I forget my master password?', 'Nobody can recover it, not even the person who made the app. If you saved the recovery key when you created the profile, it can unlock the vault; otherwise restore from an encrypted backup. Keep both somewhere safe.'],
  ['Can I use it offline, even air-gapped?', 'Yes, and that is what it was built for. Download the offline copy (one file), keep it on a USB drive and open it on a computer with no internet. Turn off all browser extensions while you use it.'],
  ['Does it work on a phone?', 'Yes. Open the site in the phone’s browser and add it to the home screen. Phones and tablets lock the vault as soon as the app is hidden.'],
  ['What leaves my device?', 'Nothing, unless you turn on optional features: GitHub gist sync (encrypted before it leaves), Beam to another device, or the contact-admin note. Watch your browser’s Network tab to see for yourself.'],
  ['Is it audited?', 'No. It has been tested heavily and its code is public so anyone can read it, but it has not had an independent security audit. Read “How secure is this, honestly?” above for what that means.'],
];

export function trustDialog() {
  modal({ title: 'How secure is this, honestly?', sub: 'What protects you, and what does not', wide: true, body: trustBody(), actions: [{ label: 'Close', primary: true }] });
}
