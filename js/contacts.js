/* Contacts: read and write the files every address book understands. DOM-free, so it is unit-tested in Node.
   - vCard (.vcf, versions 2.1 / 3.0 / 4.0): Outlook, Google Contacts, iCloud / Apple Contacts, Android, Thunderbird, most phones.
   - CSV in the Google Contacts and Outlook column layouts.
   Only what the Contact category can hold is kept: name, company, job title, one phone, one mobile, one email, one address, website, birthday,
   notes. Extra phones, emails and addresses are appended to Notes so nothing typed is lost. Photos, groups / labels, custom fields and
   anything else are left out (and counted, so the preview can say so). Nothing here touches the network. */

import { parseCSV } from './vault.js';

export const MAX_CONTACTS = 5000;

const clean = (s, max = 500) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f<>]/g, '').trim().slice(0, max);
const digits = (s) => String(s || '').replace(/\D/g, '');

/* ---------- dates ---------- */
export function normDate(v) {
  const s = String(v || '').trim(); if (!s) return '';
  let m = /^(\d{4})-?(\d{2})-?(\d{2})(?:[T ].*)?$/.exec(s);
  if (!m) { const u = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s); if (u) { let [, a, b, y] = u; a = +a; b = +b; if (a > 12 && b <= 12) [a, b] = [b, a]; m = [null, y, String(a).padStart(2, '0'), String(b).padStart(2, '0')]; } }
  if (!m) return '';
  const y = +m[1], mo = +m[2], d = +m[3]; if (y < 1000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/* ---------- vCard reading ---------- */
const unesc = (s) => String(s).replace(/\\([nN,;\\])/g, (m, c) => (c === 'n' || c === 'N' ? '\n' : c));
const splitUnesc = (v, sep) => { const out = []; let cur = ''; for (let i = 0; i < v.length; i++) { const c = v[i]; if (c === '\\' && i + 1 < v.length) { cur += c + v[i + 1]; i++; } else if (c === sep) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; };
const qpDecode = (s) => { const bytes = []; const t = s.replace(/=\r?\n/g, ''); for (let i = 0; i < t.length; i++) { if (t[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(t.slice(i + 1, i + 3))) { bytes.push(parseInt(t.slice(i + 1, i + 3), 16)); i += 2; } else bytes.push(...new TextEncoder().encode(t[i])); } try { return new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(bytes)); } catch { return t; } };

function unfold(text) {
  const lines = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n'), out = [];
  for (let i = 0; i < lines.length; i++) {
    let l = lines[i];
    if (/^[ \t]/.test(l) && out.length) { out[out.length - 1] += l.slice(1); continue; }   // RFC folding
    while (/QUOTED-PRINTABLE/i.test(l) && /=$/.test(l) && i + 1 < lines.length) { l = l.slice(0, -1) + lines[++i]; }   // 2.1 soft line breaks
    out.push(l);
  }
  return out;
}

export function parseVCard(text) {
  const lines = unfold(text), cards = []; let cur = null, photos = 0;
  for (const raw of lines) {
    if (/^BEGIN:VCARD/i.test(raw)) { cur = []; continue; }
    if (/^END:VCARD/i.test(raw)) { if (cur) cards.push(cur); cur = null; continue; }
    if (!cur || !raw.trim()) continue;
    const colon = raw.indexOf(':'); if (colon < 1) continue;
    const head = raw.slice(0, colon), param = head.split(';'), name = param[0].replace(/^.*\./, '').toUpperCase();
    const types = new Set(), meta = {};
    for (const p of param.slice(1)) { const [k, v] = p.includes('=') ? p.split(/=(.*)/s) : ['TYPE', p]; if (/^TYPE$/i.test(k)) v.split(',').forEach((t) => types.add(t.replace(/"/g, '').toUpperCase())); else meta[k.toUpperCase()] = v; }
    let value = raw.slice(colon + 1);
    if (/QUOTED-PRINTABLE/i.test(meta.ENCODING || '')) value = qpDecode(value);
    cur.push({ name, types, value });
  }
  const contacts = []; let empty = 0, extras = 0;
  for (const props of cards) {
    const c = { name: '', company: '', jobtitle: '', phone: '', mobile: '', email: '', address: '', url: '', birthday: '', notes: '', relation: '' }, other = [];
    let fn = '', given = '', family = '';
    for (const { name, types, value } of props) {
      if (name === 'FN') fn = clean(unesc(value), 200);
      else if (name === 'N') { const p = splitUnesc(value, ';').map(unesc); family = clean(p[0], 100); given = clean([p[3], p[1], p[2]].filter(Boolean).join(' ') && [p[1], p[2]].filter(Boolean).join(' '), 100); }
      else if (name === 'ORG') c.company = c.company || clean(splitUnesc(value, ';').map(unesc).filter(Boolean).join(' – '), 200);
      else if (name === 'TITLE') c.jobtitle = c.jobtitle || clean(unesc(value), 200);
      else if (name === 'TEL') { const v = clean(unesc(value).replace(/^tel:/i, ''), 60); if (!v) continue; const cell = types.has('CELL') || types.has('MOBILE') || types.has('IPHONE'); if (cell && !c.mobile) c.mobile = v; else if (!cell && !c.phone) c.phone = v; else other.push('Other phone: ' + v); }
      else if (name === 'EMAIL') { const v = clean(unesc(value), 200); if (!v) continue; if (!c.email) c.email = v; else other.push('Other email: ' + v); }
      else if (name === 'ADR') { const p = splitUnesc(value, ';').map((x) => clean(unesc(x), 200)); const street = p[2] || '', city = [p[3], p[4]].filter(Boolean).join(', '), line2 = [city, p[5]].filter(Boolean).join(' '), a = [p[0], p[1], street, line2, p[6]].filter(Boolean).join('\n'); if (!a) continue; if (!c.address) c.address = a; else other.push('Other address: ' + a.replace(/\n/g, ', ')); }
      else if (name === 'URL') c.url = c.url || clean(unesc(value), 300);
      else if (name === 'BDAY') c.birthday = c.birthday || normDate(unesc(value));
      else if (name === 'NOTE') c.notes = clean(unesc(value), 4000);
      else if (name === 'PHOTO' || name === 'LOGO') photos++;
      else if (name === 'CATEGORIES') { const g = clean(unesc(value), 100); if (g) other.push('Group: ' + g); }
      else if (!['VERSION', 'PRODID', 'REV', 'UID', 'X-ABLABEL', 'KIND', 'X-ABUID'].includes(name) && !name.startsWith('X-')) extras++;
    }
    c.name = fn || [given, family].filter(Boolean).join(' ').trim() || c.company || c.email || c.phone || c.mobile;
    if (!c.name) { empty++; continue; }
    if (other.length) c.notes = [c.notes, ...other].filter(Boolean).join('\n');
    contacts.push(c);
  }
  return { contacts, format: 'vCard', left: { photos, empty, extras } };
}

/* ---------- CSV reading (Google Contacts, Outlook) ---------- */
const nk = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
export function parseContactsCSV(text) {
  const rows = parseCSV(text); if (rows.length < 2) return { contacts: [], format: 'CSV', left: { photos: 0, empty: 0, extras: 0 } };
  const head = rows[0].map(nk); const at = (r, ...names) => { for (const n of names) { const i = head.indexOf(nk(n)); if (i >= 0 && r[i] && r[i].trim()) return r[i].trim(); } return ''; };
  const hasHead = (re) => head.some((h) => re.test(h));
  const format = hasHead(/^email1value|^organization1name|^organizationname|^phone1value|^givenname$/) ? 'Google CSV' : hasHead(/^emailaddress$|^businessphone$|^mobilephone$|^homephone$|^jobtitle$/) ? 'Outlook CSV' : 'CSV';
  const contacts = []; let empty = 0;
  const multi = (v) => String(v || '').split(/\s*:::\s*/).map((x) => x.trim()).filter(Boolean);
  for (const r of rows.slice(1)) {
    const c = { name: '', company: '', jobtitle: '', phone: '', mobile: '', email: '', address: '', url: '', birthday: '', notes: '', relation: '' }, other = [];
    const full = [at(r, 'First Name', 'Given Name'), at(r, 'Middle Name', 'Additional Name'), at(r, 'Last Name', 'Family Name')].filter(Boolean).join(' ');
    c.name = clean(full || at(r, 'Name', 'Display Name', 'File As') || at(r, 'Company', 'Organization Name', 'Organization 1 - Name'), 200);
    c.company = clean(at(r, 'Company', 'Organization Name', 'Organization 1 - Name'), 200); c.jobtitle = clean(at(r, 'Job Title', 'Organization Title', 'Organization 1 - Title'), 200);
    const emails = [];
    for (let n = 1; n <= 4; n++) emails.push(...multi(at(r, `E-mail ${n} - Value`, `Email ${n} - Value`)));
    emails.push(...[at(r, 'E-mail Address', 'Email Address', 'Email', 'E-mail'), at(r, 'E-mail 2 Address'), at(r, 'E-mail 3 Address')].filter(Boolean));
    [...new Set(emails)].forEach((e, i) => { if (i === 0) c.email = clean(e, 200); else other.push('Other email: ' + e); });
    const phones = [];   // [value, isMobile]
    for (let n = 1; n <= 5; n++) { const lab = at(r, `Phone ${n} - Label`, `Phone ${n} - Type`); for (const v of multi(at(r, `Phone ${n} - Value`))) phones.push([v, /mobile|cell|iphone/i.test(lab)]); }
    for (const [h, mob] of [['Mobile Phone', true], ['Primary Phone', false], ['Business Phone', false], ['Home Phone', false], ['Business Phone 2', false], ['Home Phone 2', false], ['Phone', false], ['Mobile', true]]) { const v = at(r, h); if (v) phones.push([v, mob]); }
    for (const [v, mob] of phones) { if (mob && !c.mobile) c.mobile = clean(v, 60); else if (!mob && !c.phone) c.phone = clean(v, 60); else if (v !== c.phone && v !== c.mobile) other.push('Other phone: ' + v); }
    const addrs = [at(r, 'Address 1 - Formatted'), at(r, 'Home Address'), [at(r, 'Home Street'), [at(r, 'Home City'), at(r, 'Home State')].filter(Boolean).join(', ') + ' ' + at(r, 'Home Postal Code'), at(r, 'Home Country/Region')].map((x) => x.trim()).filter(Boolean).join('\n'), at(r, 'Business Address'), [at(r, 'Business Street'), [at(r, 'Business City'), at(r, 'Business State')].filter(Boolean).join(', ') + ' ' + at(r, 'Business Postal Code'), at(r, 'Business Country/Region')].map((x) => x.trim()).filter(Boolean).join('\n')].filter((a) => a && a.trim());
    addrs.forEach((a, i) => { if (i === 0) c.address = clean(a, 600); else other.push('Other address: ' + a.replace(/\n/g, ', ')); });
    c.url = clean(at(r, 'Website 1 - Value', 'Web Page', 'Website', 'URL'), 300); c.birthday = normDate(at(r, 'Birthday', 'Birthday 1 - Value'));
    c.notes = clean(at(r, 'Notes', 'Note'), 4000); const labels = at(r, 'Labels', 'Categories', 'Group Membership'); if (labels) other.push('Group: ' + labels.replace(/\s*:::\s*/g, ', '));
    if (!c.name) c.name = c.email || c.phone || c.mobile; if (!c.name) { empty++; continue; }
    if (other.length) c.notes = [c.notes, ...other].filter(Boolean).join('\n');
    contacts.push(c);
  }
  return { contacts, format, left: { photos: 0, empty, extras: 0 } };
}

/* picks vCard or CSV from the text itself */
export function parseContactsFile(text) {
  const t = String(text || '');
  const r = /BEGIN:VCARD/i.test(t) ? parseVCard(t) : parseContactsCSV(t);
  if (r.contacts.length > MAX_CONTACTS) throw new Error(`That file has ${r.contacts.length} contacts. The limit is ${MAX_CONTACTS} per import: split the file and import it in parts.`);
  return r;
}

/* a contact -> the fields of a Contact item */
export const toItemData = (c) => ({ type: 'contact', name: c.name, notes: c.notes || '', fields: Object.fromEntries(Object.entries({ company: c.company, jobtitle: c.jobtitle, phone: c.phone, mobile: c.mobile, email: c.email, url: c.url, birthday: c.birthday, address: c.address, relation: c.relation }).filter(([, v]) => v)) });
export const fromItem = (it) => { const f = it.fields || {}; return { name: it.name || '', company: f.company || '', jobtitle: f.jobtitle || '', phone: f.phone || '', mobile: f.mobile || '', email: f.email || '', url: f.url || '', birthday: f.birthday || '', address: f.address || '', relation: f.relation || '', notes: [it.description, it.notes].filter(Boolean).join('\n') }; };

/* the same person already in the vault? (same email, same phone number, or same name when there is nothing else to compare) */
export function isDuplicate(c, existing) {
  const e = (c.email || '').toLowerCase(), ph = [digits(c.phone), digits(c.mobile)].filter((d) => d.length >= 7), n = (c.name || '').toLowerCase();
  return existing.some((x) => {
    const xe = (x.email || '').toLowerCase(), xp = [digits(x.phone), digits(x.mobile)].filter((d) => d.length >= 7);
    if (e && xe && e === xe) return true; if (ph.some((p) => xp.includes(p))) return true;
    return !e && !ph.length && !xe && !xp.length && n && n === (x.name || '').toLowerCase();
  });
}

/* ---------- writing ---------- */
const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\;');
const fold = (line) => { const out = []; let rest = line; while ([...rest].length > 74) { const arr = [...rest]; out.push(arr.slice(0, 74).join('')); rest = ' ' + arr.slice(74).join(''); } out.push(rest); return out.join('\r\n'); };
const splitName = (name) => { const t = String(name || '').trim(); if (t.includes(',')) { const [f, ...g] = t.split(','); return [f.trim(), g.join(' ').trim()]; } const p = t.split(/\s+/); return p.length > 1 ? [p[p.length - 1], p.slice(0, -1).join(' ')] : ['', t]; };
export function toVCard(list) {
  return list.map((c) => {
    const [family, given] = splitName(c.name), L = ['BEGIN:VCARD', 'VERSION:3.0', `N:${esc(family)};${esc(given)};;;`, `FN:${esc(c.name)}`];
    if (c.company) L.push('ORG:' + esc(c.company)); if (c.jobtitle) L.push('TITLE:' + esc(c.jobtitle));
    if (c.phone) L.push('TEL;TYPE=VOICE:' + esc(c.phone)); if (c.mobile) L.push('TEL;TYPE=CELL:' + esc(c.mobile));
    if (c.email) L.push('EMAIL;TYPE=INTERNET:' + esc(c.email)); if (c.address) L.push('ADR;TYPE=HOME:;;' + esc(c.address) + ';;;;');
    if (c.url) L.push('URL:' + esc(c.url)); if (c.birthday) L.push('BDAY:' + c.birthday); if (c.relation) L.push('CATEGORIES:' + esc(c.relation)); if (c.notes) L.push('NOTE:' + esc(c.notes));
    L.push('END:VCARD'); return L.map(fold).join('\r\n');
  }).join('\r\n') + '\r\n';
}
const cell = (v) => { let s = String(v == null ? '' : v).replace(/\r?\n/g, ' \n'); if (/^[=@\t\r]/.test(s) || /^[+-](?![\d( ])/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };   // a leading = @ (or + / - not followed by a digit, so phone numbers like +1 555… stay intact) would be run as a formula by a spreadsheet
const csv = (head, rows) => '\uFEFF' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
export function toGoogleCSV(list) {
  const head = ['First Name', 'Middle Name', 'Last Name', 'Organization Name', 'Organization Title', 'E-mail 1 - Label', 'E-mail 1 - Value', 'Phone 1 - Label', 'Phone 1 - Value', 'Phone 2 - Label', 'Phone 2 - Value', 'Address 1 - Formatted', 'Birthday', 'Website 1 - Value', 'Notes', 'Labels'];
  return csv(head, list.map((c) => { const [family, given] = splitName(c.name); return [given, '', family, c.company, c.jobtitle, c.email ? '* ' : '', c.email, c.mobile ? 'Mobile' : '', c.mobile, c.phone ? 'Work' : '', c.phone, c.address, c.birthday, c.url, c.notes, c.relation]; }));
}
export function toOutlookCSV(list) {
  const head = ['First Name', 'Middle Name', 'Last Name', 'Company', 'Job Title', 'Business Phone', 'Mobile Phone', 'E-mail Address', 'Home Street', 'Birthday', 'Web Page', 'Notes', 'Categories'];
  return csv(head, list.map((c) => { const [family, given] = splitName(c.name); return [given, '', family, c.company, c.jobtitle, c.phone, c.mobile, c.email, c.address, c.birthday, c.url, c.notes, c.relation]; }));
}
