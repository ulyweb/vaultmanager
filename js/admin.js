/* Contact the administrator (see js/config.js). Uses a mailto: link, so nothing is sent by the app itself. */
import { ADMIN_EMAIL } from './config.js';
import { APP_NAME, APP_VERSION } from './version.js';

const KEY = 'vaultmanager.admin';
const EMAIL = /^[^\s@<>"',;:\\]+@[^\s@<>"',;:\\]+\.[^\s@<>"',;:\\]{2,}$/;
export const validEmail = (e) => EMAIL.test(String(e || '').trim()) && String(e).length <= 120;

export function adminEmail(storage) {
  try { const v = storage && storage.getItem(KEY); if (v && validEmail(v)) return v.trim(); } catch { /* ignore */ }
  return validEmail(ADMIN_EMAIL) ? ADMIN_EMAIL : '';
}
export function setAdminEmail(storage, v) {
  try { if (!v) storage.removeItem(KEY); else if (validEmail(v)) storage.setItem(KEY, v.trim()); else return false; } catch { /* ignore */ }
  return true;
}
const platform = () => { try { return (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || 'unknown'; } catch { return 'unknown'; } };
export function mailtoLink(to, subject, body) { return 'mailto:' + encodeURIComponent(to).replace('%40', '@') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body); }
export function newProfileMessage(profileName) {
  return { subject: `${APP_NAME}: new profile “${profileName}”`, body: `A new profile was created.\n\nProfile name: ${profileName}\nApp: ${APP_NAME} ${APP_VERSION}\nDate: ${new Date().toISOString()}\nPlatform: ${platform()}\n\n(No passwords or vault data are included in this message.)` };
}
export function openMail(to, subject, body) {
  const a = document.createElement('a'); a.href = mailtoLink(to, subject, body); a.rel = 'noopener'; a.style.display = 'none';
  document.body.append(a); a.click(); a.remove();
}
