/* Contacts: import and export panel. It lives at the top of the Contacts page and on Import & export, and says plainly what works and what does not. */

import { h, clear, modal, toast, confirmDialog, download, readFileText } from './dom.js';
import { parseContactsFile, toItemData, fromItem, isDuplicate, toVCard, toGoogleCSV, toOutlookCSV } from './contacts.js';
import { sanitiseItem } from './vault.js';
import { stamp } from './util.js';

export const CAN = [
  'Import contacts from a vCard file (.vcf). Outlook, Google Contacts, iCloud / Apple Contacts, Android and most phones export this.',
  'Import Google Contacts CSV and Outlook CSV files.',
  'Show a preview first, and skip people you already have.',
  'Export all your contacts, or just one, as .vcf (works in all of the above), Google CSV or Outlook CSV.',
  'Work completely offline: files are read on this device and never uploaded anywhere.',
];
export const CANNOT = [
  'No live sync and no sign-in with Outlook, Google or iCloud. You move files by hand (export from one, import into the other).',
  'Photos, groups / labels and custom fields are not imported. The preview counts what is left out.',
  'Only one phone, one mobile, one email and one address are kept per contact. Extra ones are added to Notes so nothing is lost.',
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
  const leftLines = [left.photos ? `${left.photos} photo${left.photos === 1 ? '' : 's'}` : '', left.extras ? `${left.extras} other detail${left.extras === 1 ? '' : 's'} (custom fields, labels…)` : '', left.empty ? `${left.empty} entr${left.empty === 1 ? 'y' : 'ies'} with no name, email or phone` : ''].filter(Boolean);
  const body = h('div', null,
    h('p', { class: 'note ok', role: 'status', text: `Found ${contacts.length} contact${contacts.length === 1 ? '' : 's'} in this ${format} file. ${dupCount} look like people you already have.` }),
    h('table', { class: 'ctable' }, h('thead', null, h('tr', null, h('th', { text: 'Name' }), h('th', { text: 'Email / phone' }), h('th'))), h('tbody', null, rows)),
    contacts.length > 8 ? h('p', { class: 'hint', text: `…and ${contacts.length - 8} more.` }) : null,
    dupCount ? h('label', { class: 'chk', for: 'cdup' }, withDup, `Import the ${dupCount} I already have as well (creates copies)`) : null,
    leftLines.length ? h('p', { class: 'note warn', text: 'Left out: ' + leftLines.join(', ') + '. Extra phones, emails and addresses are kept in Notes.' }) : h('p', { class: 'hint', text: 'Nothing is left out.' }));
  modal({ title: 'Import contacts', sub: file.name, body, wide: true, actions: [{ label: 'Cancel' }, { label: 'Import', kind: 'primary', onClick: async () => {
    const pick = contacts.filter((c, i) => withDup.checked || !dup[i]);
    if (!pick.length) { toast('Nothing new to import.'); return; }
    const items = pick.map((c) => sanitiseItem(toItemData(c)));
    const r = ctx.store.mergeItems(items, {}); await r.save;
    ctx.store.log('import', `Imported ${r.added} contact${r.added === 1 ? '' : 's'} from a ${format} file`); await ctx.store.save().catch(() => {});
    toast(`Imported ${r.added} contact${r.added === 1 ? '' : 's'}` + (r.skipped ? `, skipped ${r.skipped} identical` : '')); ctx.refresh();
  } }] });
}

async function exportAll(ctx, kind) {
  const list = contactsOf(ctx).map(fromItem);
  if (!list.length) { toast('There are no contacts to export yet.'); return; }
  const label = { vcf: 'a vCard (.vcf) file', google: 'a Google Contacts CSV file', outlook: 'an Outlook CSV file' }[kind];
  if (!(await confirmDialog({ title: 'Export contacts?', text: `This saves ${list.length} contact${list.length === 1 ? '' : 's'} as ${label}. The file is NOT encrypted: anyone who finds it can read every name, number and address in it. Delete it after you have imported it.`, okLabel: 'Export' }))) return;
  const name = `vaultmanager-contacts-${stamp()}`;
  if (kind === 'vcf') download(name + '.vcf', toVCard(list), 'text/vcard'); else download(name + (kind === 'google' ? '-google' : '-outlook') + '.csv', kind === 'google' ? toGoogleCSV(list) : toOutlookCSV(list), 'text/csv');
  ctx.store.log('export', `Exported ${list.length} contacts (${kind})`); ctx.store.save().catch(() => {});
}

export function exportContactVcf(ctx, it) {
  download(`${(it.name || 'contact').replace(/[^\w.-]+/g, '_').slice(0, 40)}-${stamp()}.vcf`, toVCard([fromItem(it)]), 'text/vcard');
  toast('Saved as .vcf. The file is not encrypted: delete it after use.', 'info', 5000);
}

export function contactsPanel(ctx) {
  const n = contactsOf(ctx).length;
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
      h('span', { class: 'hint', text: `${n} contact${n === 1 ? '' : 's'} in this vault` })));
}
