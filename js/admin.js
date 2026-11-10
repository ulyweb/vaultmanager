/* Contact Admin and the new-profile notice — the same relay as ulyOS (see js/config.js).
   What can be sent, and only on a deliberate action:
     • Contact Admin → the name / reply address / subject / message you type, after you press Send.
     • New profile   → profile name, "protected: yes", the optional contact email you typed, time, site, language, time zone,
                       app version. NEVER passwords, keys, items, files or settings. */

import { h, modal, toast } from './dom.js';
import { CONTACT_ENDPOINT, CONTACT_EMAIL, NOTIFY_ON_PROFILE } from './config.js';
import { APP_VERSION, APP_NAME } from './version.js';
import { isSingleFile } from './offline.js';

const EMAIL = /^[^\s@<>"',;:\\]+@[^\s@<>"',;:\\]+\.[^\s@<>"',;:\\]{2,}$/;
export const validEmail = (e) => EMAIL.test(String(e || '').trim()) && String(e).length <= 120;
const isDevHost = () => /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(location.hostname) || location.protocol === 'file:';

/** Contact Admin is available (not in the single-file offline copy). */
export const enabled = () => !isSingleFile() && /^https:\/\//.test(CONTACT_ENDPOINT);
/** The admin is emailed when a profile is created or restored (never on localhost / file://). */
export const notifyEnabled = (force = false) => enabled() && NOTIFY_ON_PROFILE !== false && (force || !isDevHost());

export const DISCLOSURE = 'The administrator is notified by email when a profile is created: your profile name, that it is password-protected, and the optional email below. Passwords, keys, items, files and settings are never sent.';

function post(fields, fetchImpl = fetch) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  if (CONTACT_EMAIL) fd.append('email', CONTACT_EMAIL);   // the relay reads the recipient from here
  return fetchImpl(CONTACT_ENDPOINT, { method: 'POST', body: fd, mode: 'no-cors', keepalive: true });
}
const where = () => location.host + location.pathname;
const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } };

export function newProfileFields(profileName, extra = {}) {
  return {
    name: profileName, subject: `[${APP_NAME}] New profile: ${profileName}`,
    message: ['Event: ' + (extra.source === 'import' ? 'profile restored from backup' : 'profile created'), 'Profile name: ' + profileName, 'Protected: yes (master password required)',
      'Contact email (optional, typed by the user): ' + (extra.contact || '—'), 'Time: ' + new Date().toISOString(), `Site: ${where()} (${APP_NAME} v${APP_VERSION})`,
      'Language / time zone: ' + (navigator.language || '') + ' / ' + tz(), '', 'No passwords, keys, items, files or settings are ever included.'].join('\n'),
  };
}
export function notifyNewProfile(profileName, extra = {}, { fetchImpl, force } = {}) {
  if (!notifyEnabled(force)) return Promise.resolve(false);
  return post(newProfileFields(profileName, extra), fetchImpl).then(() => true, () => false);   // never blocks creating a profile
}

/** The Contact Admin form. */
export function contactAdmin({ profileName = '', fetchImpl } = {}) {
  if (!enabled()) return;
  const name = h('input', { class: 'inp', value: profileName, maxlength: '60', autocomplete: 'off', 'aria-label': 'Your name' });
  const reply = h('input', { class: 'inp', type: 'email', maxlength: '120', autocomplete: 'email', placeholder: 'only if you want a reply', 'aria-label': 'Your email' });
  const subject = h('input', { class: 'inp', maxlength: '120', placeholder: 'Short summary', 'aria-label': 'Subject' });
  const msg = h('textarea', { class: 'ta', rows: '5', maxlength: '4000', placeholder: 'What do you need the admin to know?', 'aria-label': 'Message to the administrator' });
  const err = h('p', { class: 'err', role: 'alert' });
  const send = async () => {
    err.textContent = '';
    if (!subject.value.trim()) { err.textContent = 'Enter a subject.'; subject.focus(); return false; }
    if (!msg.value.trim()) { err.textContent = 'Enter a message.'; msg.focus(); return false; }
    if (reply.value.trim() && !validEmail(reply.value)) { err.textContent = 'That reply email does not look right.'; reply.focus(); return false; }
    try {
      await post({ name: name.value.trim(), subject: `[${APP_NAME}] ` + subject.value.trim(),
        message: msg.value.trim() + (reply.value.trim() ? '\n\nReply-to: ' + reply.value.trim() : '') + `\n\n— sent from ${APP_NAME} v${APP_VERSION} · ${where()}` }, fetchImpl);
      toast('Message sent to the admin ✓'); return true;
    } catch { err.textContent = 'Could not send the message — check your connection and try again.'; return false; }
  };
  modal({ title: '✉ Contact Admin', sub: 'Sends a message to the administrator', body: h('div', null,
    h('p', { class: 'hint', text: 'Nothing is sent until you press Send. Never include passwords, PINs or keys.' }),
    h('div', { class: 'field' }, h('label', { text: 'Name (optional)' }), name), h('div', { class: 'field' }, h('label', { text: 'Your email (optional)' }), reply),
    h('div', { class: 'field' }, h('label', { text: 'Subject' }), subject), h('div', { class: 'field' }, h('label', { text: 'Message' }), msg), err),
    actions: [{ label: 'Cancel' }, { label: 'Send', kind: 'primary', onClick: send }] });
  setTimeout(() => subject.focus(), 60);
}
