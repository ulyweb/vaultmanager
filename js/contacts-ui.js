/* Contacts: import and export panel. It lives at the top of the Contacts page and on Import & export, and says plainly what works and what does not. */

import { h, clear, modal, toast, confirmDialog, download, readFileText } from './dom.js';
import { parseContactsFile, toItemData, fromItem, isDuplicate, toVCard, toGoogleCSV, toOutlookCSV, repairExchange } from './contacts.js';
import { b64 } from './util.js';
import { sanitiseItem } from './vault.js';
import { stamp } from './util.js';

export const CAN = [
  'Import contacts from a vCard file (.vcf), including their photos. Outlook, Google Contacts, iCloud / Apple Contacts, Android and most phones export this.',
  'Keep a photo, nickname, company, department, job title, mobile, work and home phone, two emails, home and work address, birthday, anniversary, website and notes for each contact.',
  'Import Google Contacts CSV and Outlook CSV files.',
  'Show a preview first, and skip people you already have.',
  'Export all your contacts, or just one, as .vcf with photos (works in all of the above), Google CSV or Outlook CSV.',
  'Recognise the internal Exchange address Outlook puts in place of an email (“/o=ExchangeLabs/…”) and use the real email instead, or keep the internal one in Notes.',
  'Work completely offline: files are read on this device and never uploaded anywhere.',
];
export const CANNOT = [
  'No live sync and no sign-in with Outlook, Google or iCloud. You move files by hand (export from one, import into the other).',
  'CSV files (Google, Outlook) never contain photos: only a .vcf file carries them. Photos given only as a web link are not downloaded.',
  'Groups / labels and custom fields are not imported as fields (groups go into Notes). The preview counts what is left out.',
  'Only three phones (mobile, work, home), two emails and two addresses (home, work) are kept per contact. Extra ones are added to Notes so nothing is lost.',
  'Exported files are NOT encrypted: anyone who finds them can read them. Delete them after use.',
  'Importing never changes or deletes contacts you already have.',
  'Contacts locked with a passcode are not included in exports.',
];

const contactsOf = (ctx) => ctx.store.active().filter((i) => i.type === 'contact' && !i.lock);
const existingOf = (ctx) => ctx.store.active().filter((i) => i.type === 'contact').map(fromItem);

async function importFile(ctx, file) {
  if (file.size > 10 * 1024 * 1024) { toast('That file is larger than 10 MB. Split it and import it in parts.', 'err', 6000); return; }
  let parsed;
  try { parsed = parseContactsFile(await readFileText(file)); } catch (e) { toast(e.message, 'err', 6000); return; }
  const { contacts, format, left } = parsed;
  if (!contacts.length) { toast('No contacts found in that file. It should be a .vcf or a Google / Outlook CSV.', 'err', 6000); return; }
  const have = existingOf(ctx), dup = contacts.map((c) => isDuplicate(c, have)), dupCount = dup.filter(Boolean).length;
  const withDup = h('input', { type: 'checkbox', id: 'cdup' });
  const rows = contacts.slice(0, 8).map((c, i) => h('tr', null, h('td', { text: c.name }), h('td', { text: c.email || c.mobile || c.phone || '' }), h('td', { text: dup[i] ? 'already here' : '' })));
  const withPhoto = contacts.filter((c) => c.photo).length;
  const leftLines = [left.photos ? `${left.photos} photo${left.photos === 1 ? '' : 's'} that are only web links or too large` : '', left.extras ? `${left.extras} other detail${left.extras === 1 ? '' : 's'} (custom fields, labels…)` : '', left.empty ? `${left.empty} entr${left.empty === 1 ? 'y' : 'ies'} with no name, email or phone` : ''].filter(Boolean);
  const body = h('div', null,
    h('p', { class: 'note ok', role: 'status', text: `Found ${contacts.length} contact${contacts.length === 1 ? '' : 's'} in this ${format} file${withPhoto ? `, ${withPhoto} with a photo` : ''}. ${dupCount} look like people you already have.` }),
    h('table', { class: 'ctable' }, h('thead', null, h('tr', null, h('th', { text: 'Name' }), h('th', { text: 'Email / phone' }), h('th'))), h('tbody', null, rows)),
    contacts.length > 8 ? h('p', { class: 'hint', text: `…and ${contacts.length - 8} more.` }) : null,
    dupCount ? h('label', { class: 'chk', for: 'cdup' }, withDup, `Import the ${dupCount} I already have as well (creates copies)`) : null,
    leftLines.length ? h('p', { class: 'note warn', text: 'Left out: ' + leftLines.join(', ') + '. Extra phones, emails and addresses are kept in Notes.' }) : h('p', { class: 'hint', text: 'Nothing is left out.' }));
  modal({ title: 'Import contacts', sub: file.name, body, wide: true, actions: [{ label: 'Cancel' }, { label: 'Import', kind: 'primary', onClick: async () => {
    const pick = contacts.filter((c, i) => withDup.checked || !dup[i]);
    if (!pick.length) { toast('Nothing new to import.'); return; }
    const items = pick.map((c, i) => { const d = toItemData(c); if (c.photo) d.fields.photo = 'pending:' + i; return sanitiseItem(d); });
    const r = ctx.store.mergeItems(items, {}); await r.save;
    let photos = 0;
    for (const it of ctx.store.active().filter((x) => x.type === 'contact' && /^pending:\d+$/.test((x.fields || {}).photo || ''))) {
      const c = pick[+it.fields.photo.slice(8)], fields = { ...it.fields }; delete fields.photo;
      try { if (c && c.photo) { const att = await ctx.store.addAttachment(it.id, { name: 'contact-photo.' + (/png/i.test(c.photo.type) ? 'png' : 'jpg'), type: c.photo.type, bytes: b64.dec(c.photo.b64) }); fields.photo = att.id; photos++; } } catch { /* a broken picture is skipped */ }
      await ctx.store.update(it.id, { fields });
    }
    ctx.store.log('import', `Imported ${r.added} contact${r.added === 1 ? '' : 's'} from a ${format} file`); await ctx.store.save().catch(() => {});
    toast(`Imported ${r.added} contact${r.added === 1 ? '' : 's'}` + (photos ? ` with ${photos} photo${photos === 1 ? '' : 's'}` : '') + (r.skipped ? `, skipped ${r.skipped} identical` : '')); ctx.refresh();
  } }] });
}

async function withPhotos(ctx, items) {
  const out = [];
  for (const it of items) { const c = fromItem(it), id = (it.fields || {}).photo; if (id && (it.attachments || []).some((a) => a.id === id)) { try { const { meta, bytes } = await ctx.store.readAttachment(it.id, id); c.photo = { type: meta.type, b64: b64.enc(bytes) }; } catch { /* not on this device */ } } out.push(c); }
  return out;
}
async function exportAll(ctx, kind) {
  const list = kind === 'vcf' ? await withPhotos(ctx, contactsOf(ctx)) : contactsOf(ctx).map(fromItem);
  if (!list.length) { toast('There are no contacts to export yet.'); return; }
  const label = { vcf: 'a vCard (.vcf) file', google: 'a Google Contacts CSV file', outlook: 'an Outlook CSV file' }[kind];
  if (!(await confirmDialog({ title: 'Export contacts?', text: `This saves ${list.length} contact${list.length === 1 ? '' : 's'} as ${label}. The file is NOT encrypted: anyone who finds it can read every name, number and address in it. Delete it after you have imported it.`, okLabel: 'Export' }))) return;
  const name = `vaultmanager-contacts-${stamp()}`;
  if (kind === 'vcf') download(name + '.vcf', toVCard(list), 'text/vcard'); else download(name + (kind === 'google' ? '-google' : '-outlook') + '.csv', kind === 'google' ? toGoogleCSV(list) : toOutlookCSV(list), 'text/csv');
  ctx.store.log('export', `Exported ${list.length} contacts (${kind})`); ctx.store.save().catch(() => {});
}

export async function exportContactVcf(ctx, it) {
  download(`${(it.name || 'contact').replace(/[^\w.-]+/g, '_').slice(0, 40)}-${stamp()}.vcf`, toVCard(await withPhotos(ctx, [it])), 'text/vcard');
  toast('Saved as .vcf. The file is not encrypted: delete it after use.', 'info', 5000);
}

async function repairAll(ctx) {
  let n = 0;
  for (const it of ctx.store.active().filter((x) => x.type === 'contact' && !x.lock)) { const fix = repairExchange(it); if (fix) { await ctx.store.update(it.id, fix); n++; } }
  toast(n ? `Fixed ${n} contact${n === 1 ? '' : 's'}: the internal Exchange address was moved to Notes.` : 'Nothing to fix.'); ctx.refresh();
}
export function contactsPanel(ctx) {
  const n = contactsOf(ctx).length, broken = ctx.store.active().filter((x) => x.type === 'contact' && !x.lock && repairExchange(x)).length;
  const ul = (items, cls) => h('ul', { class: 'cio-list ' + cls }, items.map((t) => h('li', { text: t })));
  const file = h('input', { type: 'file', accept: '.vcf,.csv,.txt,text/vcard,text/csv', class: 'offscreen', 'aria-label': 'Contacts file', on: { change: async (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) await importFile(ctx, f); } } });
  return h('div', { class: 'panel pad contactsio' },
    h('h3', { text: 'Contacts: import and export' }),
    h('div', { class: 'ccols' },
      h('div', { class: 'ccan' }, h('h4', { text: '✓ What it can do' }), ul(CAN, 'can')),
      h('div', { class: 'ccant' }, h('h4', { text: '✗ What it cannot do' }), ul(CANNOT, 'cannot'))),
    h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', on: { click: () => file.click() } }, '{{importfile}} Import contacts…'), file,
      h('button', { class: 'btn', on: { click: () => exportAll(ctx, 'vcf') } }, '{{exportfile}} Export all as .vcf'),
      h('button', { class: 'btn', on: { click: () => exportAll(ctx, 'google') } }, 'Google CSV'),
      h('button', { class: 'btn', on: { click: () => exportAll(ctx, 'outlook') } }, 'Outlook CSV'),
      h('span', { class: 'hint', text: `${n} contact${n === 1 ? '' : 's'} in this vault` })),
    broken ? h('div', { class: 'note warn', role: 'status' }, `${broken} contact${broken === 1 ? ' has' : 's have'} an internal Exchange address (“/o=ExchangeLabs/…”) where the email should be. `, h('button', { class: 'btn sm', on: { click: () => repairAll(ctx) } }, 'Fix them')) : null);
}
