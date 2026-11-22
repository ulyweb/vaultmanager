/* "How secure is this, honestly?" — a plain-language explanation of what protects the data, how a browser app compares with a native one,
   and what nobody can promise. Every claim here is something a person can check (see "Check it yourself") or something SECURITY.md documents.
   It deliberately does NOT say "guaranteed" or "audited": no software can honestly promise the first, and this has not had the second. */

import { h } from './dom.js';

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
  ['How can my family get in if something happens to me?', 'Open Family recovery in the left menu. It helps you write a printable guide for them, split the vault password into shares (for example any 2 of 3 people can rebuild it, but no single person can), and run a restore drill so you know it really works. Keep the sealed data and the password shares in different places.'],
  ['Can it be my authenticator for 2FA codes? What it can and cannot do, and the trade-off', [
    'Yes, for logins. Open a Login item, then paste the site’s 2FA setup key into “2FA one-time code secret”, or press “Scan QR with camera” or “QR from image / screenshot”. The item then shows the current code with a countdown and a copy button, and the Home screen has a “One-time codes” widget. It is the standard time-based method (TOTP) that Google Authenticator, Microsoft Authenticator, Authy and Bitwarden use. Your browser works out each code on this device, with no server, so it also works offline. Bitwarden exports bring their 2FA secrets across.',
    'It can: make the 6, 7 or 8-digit codes for any site that offers “use an authenticator app”; read the site’s setup QR from the camera or from a screenshot, on this device only; and keep the secret encrypted with the rest of the vault, in backups, sync and Seal as QR.',
    'It cannot: do counter-based (HOTP) codes, “tap Yes on your phone” push approvals, SMS or email codes, or security keys; read a Google Authenticator export QR (add each account from its own site instead); add 2FA to categories other than Login; or fill the code in for you (copy and paste it). Codes depend on this device’s clock, so keep the clock set automatically. And it cannot bring 2FA back if you lose the vault: keep each site’s recovery codes outside VaultManager, for example printed.',
    'The trade-off: 2FA is meant to be a second, separate step, something you know (the password) plus something you have (an authenticator on another device). When the 2FA secret sits in the same vault as the password, anyone who opens the vault, for example with your master password or through malware on this computer, gets both steps at once. It still protects you when a site’s password leaks or is guessed, because the code is not in that leak. It does not protect you if the vault itself is opened. Bitwarden has the same trade-off.',
    'What we recommend: keep 2FA here for everyday accounts if you like the convenience. For the accounts everything else depends on (your main email, your bank, and the account that holds your backups or sync, such as GitHub), keep 2FA in a separate authenticator app or on a security key.',
  ]],
  ['What does “Master password re-prompt” do, and how is it different from a secondary passcode?', [
    'Turn it on for any item, in any category, under “Additional options” when you create or edit it. That item then shows only its name and category, in the list, in search and in the Trash, until you type your master password again. Seeing, copying or editing it, and its code in the Home “One-time codes” widget, all wait for the master password. After that it stays shown for 5 minutes, or until the vault locks. Wrong passwords make you wait longer each time.',
    'What it protects against: someone using your computer or phone while the vault is unlocked, or people seeing your screen while you share it or work in public. It works like Bitwarden’s option of the same name, and the setting travels with Bitwarden imports and exports.',
    'What it does not protect against: it adds no encryption. The item is decrypted with the rest of the vault, so malware on the device, or anyone who knows your master password, can still read it.',
    'If you need real extra protection for an item, use “Protect this item with a secondary passcode” instead. That encrypts the item’s details again with a separate passcode, so even someone who has your master password cannot read it. You can use both on the same item.',
  ]],
  ['Is it audited?', 'No. It has been tested heavily and its code is public so anyone can read it, but it has not had an independent security audit. Read “How secure is this, honestly?” above for what that means.'],
];
