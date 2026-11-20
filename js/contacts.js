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

/* everything a Contact item can hold */
export const blank = () => ({ name: '', nickname: '', company: '', department: '', jobtitle: '', phone: '', mobile: '', homephone: '', email: '', email2: '', address: '', workaddress: '', url: '', birthday: '', anniversary: '', notes: '', relation: '', photo: null });

/* Outlook exports from an Exchange / Microsoft 365 account often put an internal Exchange address ("/o=ExchangeLabs/ou=…/cn=…") where the email
   should be. It is not an email address, so it is never stored as one: the real address is taken from the display name ("Name (name@company.com)")
   or another email column when there is one, and the internal one is kept in Notes. */
export const isExchangeDN = (v) => /^\/o=/i.test(String(v || '').trim()) || /^EX:/i.test(String(v || '').trim());
export const isEmail = (v) => /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/.test(String(v || '').trim());
const emailIn = (s) => { const m = /([^\s@<>()"']+@[^\s@<>()"']+\.[^\s@<>()"']+)/.exec(String(s || '')); return m ? m[1] : ''; };

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

/* PHOTO: an embedded picture (base64, vCard 2.1 / 3.0, or a data: URI in 4.0). A web address is not fetched (nothing leaves the device). */
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
function readPhoto(value, types, meta) {
  let v = String(value || '').trim(), mime = '';
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/is.exec(v);
  if (m) { mime = m[1].toLowerCase(); v = m[2]; }
  else if (/^(https?|ftp):/i.test(v)) return null;
  else if (!/^(b|base64)$/i.test(meta.ENCODING || '') && !/BASE64/i.test([...types].join(','))) return null;
  if (!mime) { const t = [...types].find((x) => /JPE?G|PNG|GIF|WEBP|HEIC|BMP/.test(x)) || (meta.TYPE || ''); mime = /PNG/i.test(t) ? 'image/png' : /GIF/i.test(t) ? 'image/gif' : /WEBP/i.test(t) ? 'image/webp' : 'image/jpeg'; }
  const b64 = v.replace(/\s+/g, ''); if (!/^[A-Za-z0-9+/=]+$/.test(b64) || b64.length < 16) return null;
  if (b64.length * 0.75 > MAX_PHOTO_BYTES) return null;
  return { type: mime, b64 };
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
    cur.push({ name, types, value, meta });
  }
  const contacts = []; let empty = 0, extras = 0;
  for (const props of cards) {
    const c = blank(), other = [];
    let fn = '', given = '', family = '';
    for (const { name, types, value, meta } of props) {
      if (name === 'FN') fn = clean(unesc(value), 200);
      else if (name === 'N') { const p = splitUnesc(value, ';').map(unesc); family = clean(p[0], 100); given = clean([p[1], p[2]].filter(Boolean).join(' '), 100); }
      else if (name === 'NICKNAME') c.nickname = c.nickname || clean(unesc(value), 100);
      else if (name === 'ORG') { const p = splitUnesc(value, ';').map((x) => clean(unesc(x), 200)).filter(Boolean); c.company = c.company || p[0] || ''; c.department = c.department || p.slice(1).join(', '); }
      else if (name === 'TITLE') c.jobtitle = c.jobtitle || clean(unesc(value), 200);
      else if (name === 'TEL') {
        const v = clean(unesc(value).replace(/^tel:/i, ''), 60); if (!v) continue;
        const slot = types.has('CELL') || types.has('MOBILE') || types.has('IPHONE') ? 'mobile' : types.has('HOME') && !types.has('WORK') ? 'homephone' : 'phone';
        if (!c[slot]) c[slot] = v; else if (slot === 'phone' && !c.homephone && !types.has('WORK')) c.homephone = v; else other.push('Other phone: ' + v);
      } else if (name === 'EMAIL') {
        let v = clean(unesc(value).replace(/^mailto:/i, ''), 200); if (!v) continue;
        if (!isEmail(v)) { const inside = emailIn(v); if (isExchangeDN(v) || !inside) { other.push('Exchange / other address: ' + v); continue; } v = inside; }
        if (!c.email) c.email = v; else if (!c.email2 && v.toLowerCase() !== c.email.toLowerCase()) c.email2 = v; else if (v.toLowerCase() !== c.email.toLowerCase()) other.push('Other email: ' + v);
      } else if (name === 'ADR') {
        const p = splitUnesc(value, ';').map((x) => clean(unesc(x), 200)); const street = p[2] || '', city = [p[3], p[4]].filter(Boolean).join(', '), line2 = [city, p[5]].filter(Boolean).join(' '), a = [p[0], p[1], street, line2, p[6]].filter(Boolean).join('\n'); if (!a) continue;
        const slot = types.has('WORK') ? 'workaddress' : 'address';
        if (!c[slot]) c[slot] = a; else if (slot === 'address' && !c.workaddress && !types.has('HOME')) c.workaddress = a; else other.push('Other address: ' + a.replace(/\n/g, ', '));
      } else if (name === 'URL') c.url = c.url || clean(unesc(value), 300);
      else if (name === 'BDAY') c.birthday = c.birthday || normDate(unesc(value));
      else if (name === 'ANNIVERSARY' || name === 'X-ANNIVERSARY' || name === 'X-MS-ANNIVERSARY' || name === 'X-EVOLUTION-ANNIVERSARY') c.anniversary = c.anniversary || normDate(unesc(value));
      else if (name === 'NOTE') c.notes = clean(unesc(value), 4000);
      else if (name === 'PHOTO') { const ph = readPhoto(value, types, meta); if (ph && !c.photo) c.photo = ph; else photos++; }
      else if (name === 'LOGO') photos++;
      else if (name === 'CATEGORIES') { const g = clean(unesc(value), 100); if (g) other.push('Group: ' + g); }
      else if (!['VERSION', 'PRODID', 'REV', 'UID', 'X-ABLABEL', 'KIND', 'X-ABUID', 'X-ABDATE'].includes(name) && !name.startsWith('X-')) extras++;
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
    const c = blank(), other = [];
    const full = [at(r, 'First Name', 'Given Name'), at(r, 'Middle Name', 'Additional Name'), at(r, 'Last Name', 'Family Name')].filter(Boolean).join(' ');
    c.name = clean(full || at(r, 'Name', 'Display Name', 'File As') || at(r, 'Company', 'Organization Name', 'Organization 1 - Name'), 200);
    c.nickname = clean(at(r, 'Nickname'), 100);
    c.company = clean(at(r, 'Company', 'Organization Name', 'Organization 1 - Name'), 200); c.jobtitle = clean(at(r, 'Job Title', 'Organization Title', 'Organization 1 - Title'), 200);
    c.department = clean(at(r, 'Department', 'Organization Department', 'Organization 1 - Department'), 200);
    // emails: Google "E-mail N - Value" (with ::: for several), Outlook "E-mail Address" / "E-mail 2 Address" / "E-mail 3 Address" with their Type and Display Name
    const emails = [];
    for (let n = 1; n <= 4; n++) emails.push(...multi(at(r, `E-mail ${n} - Value`, `Email ${n} - Value`)));
    for (const [addr, disp] of [['E-mail Address', 'E-mail Display Name'], ['E-mail 2 Address', 'E-mail 2 Display Name'], ['E-mail 3 Address', 'E-mail 3 Display Name']]) {
      const v = at(r, addr, addr.replace('E-mail', 'Email')); if (!v) continue;
      if (isEmail(v)) { emails.push(v); continue; }
      const real = emailIn(at(r, disp, disp.replace('E-mail', 'Email'))) || emailIn(v);
      if (real) emails.push(real);
      if (isExchangeDN(v) || !real) other.push('Exchange / other address: ' + v);
    }
    const plain = at(r, 'Email', 'E-mail'); if (plain) emails.push(plain);
    [...new Set(emails.map((e) => e.trim()).filter((e) => isEmail(e)))].forEach((e, i) => { if (i === 0) c.email = clean(e, 200); else if (i === 1) c.email2 = clean(e, 200); else other.push('Other email: ' + e); });
    // phones: [value, slot]
    const phones = [];
    for (let n = 1; n <= 5; n++) { const lab = at(r, `Phone ${n} - Label`, `Phone ${n} - Type`); for (const v of multi(at(r, `Phone ${n} - Value`))) phones.push([v, /mobile|cell|iphone/i.test(lab) ? 'mobile' : /home/i.test(lab) ? 'homephone' : 'phone']); }
    for (const [hd, slot] of [['Mobile Phone', 'mobile'], ['Business Phone', 'phone'], ['Home Phone', 'homephone'], ['Primary Phone', 'phone'], ['Business Phone 2', 'phone'], ['Home Phone 2', 'homephone'], ['Company Main Phone', 'phone'], ['Other Phone', 'phone'], ['Phone', 'phone'], ['Mobile', 'mobile']]) { const v = at(r, hd); if (v) phones.push([v, slot]); }
    for (const [v, slot] of phones) { const val = clean(v, 60); if ([c.phone, c.mobile, c.homephone].includes(val)) continue; if (!c[slot]) c[slot] = val; else if (slot === 'phone' && !c.homephone) c.homephone = val; else other.push('Other phone: ' + v); }
    // addresses: home and work
    const block = (pre) => [at(r, pre + ' Street'), [[at(r, pre + ' City'), at(r, pre + ' State')].filter(Boolean).join(', '), at(r, pre + ' Postal Code')].filter(Boolean).join(' '), at(r, pre + ' Country/Region', pre + ' Country')].filter(Boolean).join('\n');
    const gAddr = []; for (let n = 1; n <= 3; n++) { const v = at(r, `Address ${n} - Formatted`); if (v) gAddr.push([v, at(r, `Address ${n} - Label`, `Address ${n} - Type`)]); }
    const home = at(r, 'Home Address') || block('Home'), work = at(r, 'Business Address') || block('Business'), oth = block('Other');
    for (const [v, lab] of gAddr) { if (/work|business/i.test(lab) && !c.workaddress) c.workaddress = clean(v, 600); else if (!c.address) c.address = clean(v, 600); else other.push('Other address: ' + v.replace(/\n/g, ', ')); }
    if (home && !c.address) c.address = clean(home, 600); if (work && !c.workaddress) c.workaddress = clean(work, 600); if (oth) other.push('Other address: ' + oth.replace(/\n/g, ', '));
    c.url = clean(at(r, 'Website 1 - Value', 'Web Page', 'Website', 'URL', 'Personal Web Page'), 300); c.birthday = normDate(at(r, 'Birthday', 'Birthday 1 - Value'));
    c.anniversary = normDate(at(r, 'Anniversary')); for (let n = 1; n <= 3; n++) if (!c.anniversary && /anniversary/i.test(at(r, `Event ${n} - Label`, `Event ${n} - Type`))) c.anniversary = normDate(at(r, `Event ${n} - Value`));
    c.notes = clean(at(r, 'Notes', 'Note'), 4000); const labels = at(r, 'Labels', 'Categories', 'Group Membership'); if (labels) other.push('Group: ' + labels.replace(/\s*:::\s*/g, ', '));
    if (!c.name) c.name = c.email || c.phone || c.mobile || c.homephone; if (!c.name) { empty++; continue; }
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
const KEYS = ['nickname', 'company', 'department', 'jobtitle', 'mobile', 'phone', 'homephone', 'email', 'email2', 'relation', 'birthday', 'anniversary', 'url', 'address', 'workaddress'];
export const toItemData = (c) => ({ type: 'contact', name: c.name, notes: c.notes || '', fields: Object.fromEntries(KEYS.map((k) => [k, c[k]]).filter(([, v]) => v)) });
export const fromItem = (it) => { const f = it.fields || {}, c = blank(); for (const k of KEYS) c[k] = f[k] || ''; c.name = it.name || ''; c.notes = [it.description, it.notes].filter(Boolean).join('\n'); return c; };

/* the same person already in the vault? (same email, same phone number, or same name when there is nothing else to compare) */
export function isDuplicate(c, existing) {
  const e = [c.email, c.email2].filter(isEmail).map((x) => x.toLowerCase()), ph = [digits(c.phone), digits(c.mobile), digits(c.homephone)].filter((d) => d.length >= 7), n = (c.name || '').toLowerCase();
  return existing.some((x) => {
    const xe = [x.email, x.email2].filter(isEmail).map((y) => y.toLowerCase()), xp = [digits(x.phone), digits(x.mobile), digits(x.homephone)].filter((d) => d.length >= 7);
    if (e.some((v) => xe.includes(v))) return true; if (ph.some((p) => xp.includes(p))) return true;
    return !e.length && !ph.length && !xe.length && !xp.length && n && n === (x.name || '').toLowerCase();
  });
}

/* ---------- writing ---------- */
const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\;');
const fold = (line) => { const out = []; let rest = line; while ([...rest].length > 74) { const arr = [...rest]; out.push(arr.slice(0, 74).join('')); rest = ' ' + arr.slice(74).join(''); } out.push(rest); return out.join('\r\n'); };
const splitName = (name) => { const t = String(name || '').trim(); if (t.includes(',')) { const [f, ...g] = t.split(','); return [f.trim(), g.join(' ').trim()]; } const p = t.split(/\s+/); return p.length > 1 ? [p[p.length - 1], p.slice(0, -1).join(' ')] : ['', t]; };
export function toVCard(list) {
  return list.map((c) => {
    const [family, given] = splitName(c.name), L = ['BEGIN:VCARD', 'VERSION:3.0', `N:${esc(family)};${esc(given)};;;`, `FN:${esc(c.name)}`];
    if (c.nickname) L.push('NICKNAME:' + esc(c.nickname));
    if (c.company || c.department) L.push('ORG:' + esc(c.company || '') + (c.department ? ';' + esc(c.department) : '')); if (c.jobtitle) L.push('TITLE:' + esc(c.jobtitle));
    if (c.mobile) L.push('TEL;TYPE=CELL:' + esc(c.mobile)); if (c.phone) L.push('TEL;TYPE=WORK,VOICE:' + esc(c.phone)); if (c.homephone) L.push('TEL;TYPE=HOME,VOICE:' + esc(c.homephone));
    if (c.email) L.push('EMAIL;TYPE=INTERNET:' + esc(c.email)); if (c.email2) L.push('EMAIL;TYPE=INTERNET:' + esc(c.email2));
    if (c.address) L.push('ADR;TYPE=HOME:;;' + esc(c.address) + ';;;;'); if (c.workaddress) L.push('ADR;TYPE=WORK:;;' + esc(c.workaddress) + ';;;;');
    if (c.url) L.push('URL:' + esc(c.url)); if (c.birthday) L.push('BDAY:' + c.birthday); if (c.anniversary) L.push('X-ANNIVERSARY:' + c.anniversary);
    if (c.relation) L.push('CATEGORIES:' + esc(c.relation)); if (c.notes) L.push('NOTE:' + esc(c.notes));
    if (c.photo && c.photo.b64) L.push(`PHOTO;ENCODING=b;TYPE=${/png/i.test(c.photo.type) ? 'PNG' : /gif/i.test(c.photo.type) ? 'GIF' : 'JPEG'}:` + c.photo.b64);
    L.push('END:VCARD'); return L.map(fold).join('\r\n');
  }).join('\r\n') + '\r\n';
}
const cell = (v) => { let s = String(v == null ? '' : v).replace(/\r?\n/g, ' \n'); if (/^[=@\t\r]/.test(s) || /^[+-](?![\d( ])/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };   // a leading = @ (or + / - not followed by a digit, so phone numbers like +1 555… stay intact) would be run as a formula by a spreadsheet
const csv = (head, rows) => '\uFEFF' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
export function toGoogleCSV(list) {
  const head = ['First Name', 'Middle Name', 'Last Name', 'Nickname', 'Organization Name', 'Organization Title', 'Organization Department', 'E-mail 1 - Label', 'E-mail 1 - Value', 'E-mail 2 - Label', 'E-mail 2 - Value', 'Phone 1 - Label', 'Phone 1 - Value', 'Phone 2 - Label', 'Phone 2 - Value', 'Phone 3 - Label', 'Phone 3 - Value', 'Address 1 - Label', 'Address 1 - Formatted', 'Address 2 - Label', 'Address 2 - Formatted', 'Birthday', 'Event 1 - Label', 'Event 1 - Value', 'Website 1 - Value', 'Notes', 'Labels'];
  return csv(head, list.map((c) => { const [family, given] = splitName(c.name); return [given, '', family, c.nickname, c.company, c.jobtitle, c.department, c.email ? '* ' : '', c.email, c.email2 ? 'Other' : '', c.email2, c.mobile ? 'Mobile' : '', c.mobile, c.phone ? 'Work' : '', c.phone, c.homephone ? 'Home' : '', c.homephone, c.address ? 'Home' : '', c.address, c.workaddress ? 'Work' : '', c.workaddress, c.birthday, c.anniversary ? 'Anniversary' : '', c.anniversary, c.url, c.notes, c.relation]; }));
}
export function toOutlookCSV(list) {
  const head = ['First Name', 'Middle Name', 'Last Name', 'Nickname', 'Company', 'Department', 'Job Title', 'Business Phone', 'Home Phone', 'Mobile Phone', 'E-mail Address', 'E-mail 2 Address', 'Home Street', 'Business Street', 'Birthday', 'Anniversary', 'Web Page', 'Notes', 'Categories'];
  return csv(head, list.map((c) => { const [family, given] = splitName(c.name); return [given, '', family, c.nickname, c.company, c.department, c.jobtitle, c.phone, c.homephone, c.mobile, c.email, c.email2, c.address, c.workaddress, c.birthday, c.anniversary, c.url, c.notes, c.relation]; }));
}

/* contacts imported before the Exchange fix may hold an internal Exchange address as their email: move it to Notes */
export function repairExchange(it) {
  const f = { ...(it.fields || {}) }; let notes = it.notes || '', changed = false;
  for (const k of ['email', 'email2']) if (f[k] && !isEmail(f[k])) { const real = emailIn(f[k]); notes = [notes, 'Exchange / other address: ' + f[k]].filter(Boolean).join('\n'); if (real) f[k] = real; else delete f[k]; changed = true; }
  if (!f.email && f.email2) { f.email = f.email2; delete f.email2; }
  return changed ? { fields: f, notes } : null;
}
