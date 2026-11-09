/* Item categories ("templates"). login / note / card keep their dedicated fields; every other category is
   described here as a list of fields, so adding a category is a few lines of data — no new UI code.
   Every item, whatever its category, also gets: name, notes, tags, favourite, attachments and custom fields.

   field: { k: key, l: label, kind: text | secret | url | date | multiline | select, options?, gen?, expiry?, mono?, ph? }
     secret    masked in the UI, copy/reveal audited, never indexed by search
     gen       offers the password generator in the editor
     expiry    a date that feeds the "expiring soon" report in Vault health */

export const CORE = {
  login: { label: 'Login', icon: '🔑', plural: 'Logins' },
  note: { label: 'Secure note', icon: '📝', plural: 'Secure notes' },
  card: { label: 'Payment card', icon: '💳', plural: 'Cards' },
};

const S = (k, l, o = {}) => ({ k, l, kind: 'secret', mono: true, ...o });
const T = (k, l, o = {}) => ({ k, l, kind: 'text', ...o });
const D = (k, l, o = {}) => ({ k, l, kind: 'date', ...o });
const U = (k, l, o = {}) => ({ k, l, kind: 'url', ...o });
const SEL = (k, l, options) => ({ k, l, kind: 'select', options });

export const TEMPLATES = {
  app: { label: 'App / software', plural: 'Apps', icon: '📦', sub: 'version', fields: [
    T('version', 'Version'), S('license', 'License key'), T('email', 'Registered email'), U('url', 'Download / support page'), D('purchased', 'Purchase date'), D('expires', 'Renewal / expiry date', { expiry: true }), T('seats', 'Seats / devices'),
  ] },
  network: { label: 'Wi-Fi / network', plural: 'Network', icon: '📶', sub: 'ssid', fields: [
    T('ssid', 'Network name (SSID)'), SEL('security', 'Security', ['WPA3', 'WPA2', 'WPA', 'WEP', 'None']), S('wifipw', 'Wi-Fi password', { gen: true }),
    U('adminurl', 'Router admin address'), T('adminuser', 'Router admin username'), S('adminpw', 'Router admin password', { gen: true }), T('ip', 'IP / DNS / notes'),
  ] },
  computer: { label: 'Computer account', plural: 'Computers', icon: '💻', sub: 'host', fields: [
    T('host', 'Computer / host name'), SEL('os', 'Operating system', ['Windows', 'macOS', 'Linux', 'iOS / iPadOS', 'Android', 'ChromeOS', 'Other']), T('username', 'Username'), S('password', 'Password', { gen: true }),
    T('domain', 'Domain / workgroup'), S('recovery', 'Disk recovery key (BitLocker / FileVault)'), T('serial', 'Serial number'), T('ip', 'IP address'),
  ] },
  shopping: { label: 'Shopping / store', plural: 'Shopping', icon: '🛒', sub: 'url', fields: [
    U('url', 'Website'), T('username', 'Username / email'), S('password', 'Password', { gen: true }), T('member', 'Loyalty / member number', { mono: true }), S('giftcard', 'Gift card number'), S('giftpin', 'Gift card PIN'), { k: 'address', l: 'Shipping address', kind: 'multiline' },
  ] },
  insurance: { label: 'Insurance', plural: 'Insurance', icon: '🛡️', sub: 'provider', fields: [
    T('provider', 'Provider'), SEL('kind', 'Type', ['Auto', 'Home / renters', 'Health', 'Life', 'Travel', 'Pet', 'Umbrella', 'Other']), T('policy', 'Policy number', { mono: true }), T('group', 'Group number', { mono: true }), T('member', 'Member ID', { mono: true }),
    T('phone', 'Claims phone'), T('agent', 'Agent / broker'), T('premium', 'Premium'), D('renews', 'Renewal date', { expiry: true }), U('url', 'Website'), T('username', 'Username'), S('password', 'Password', { gen: true }),
  ] },
  locker: { label: 'Locker / combination', plural: 'Lockers', icon: '🔢', sub: 'location', fields: [
    SEL('kind', 'Type', ['Locker', 'Safe', 'Padlock', 'Luggage lock', 'Door / gate code', 'Alarm code', 'Other']), T('location', 'Location'), T('number', 'Locker / safe number'), S('combo', 'Combination / code'), S('spare', 'Spare / master code'),
  ] },
  travel: { label: 'Travel', plural: 'Travel', icon: '✈️', sub: 'program', fields: [
    SEL('kind', 'Type', ['Passport', 'Visa', 'Frequent flyer', 'Booking / reservation', 'Known traveller (TSA / Global Entry)', 'Travel insurance', 'Other']), T('holder', 'Name on document'), S('number', 'Number / confirmation code'),
    T('program', 'Airline / hotel / program'), D('issued', 'Issue date'), D('expires', 'Expiry date', { expiry: true }), D('start', 'Travel start'), D('end', 'Travel end'), U('url', 'Website'), T('username', 'Username'), S('password', 'Password', { gen: true }),
  ] },
  identity: { label: 'ID / identity', plural: 'Identity', icon: '🪪', sub: 'doc', fields: [
    SEL('doc', 'Document', ['Driver licence', 'National ID', 'Social security / tax number', 'Birth certificate', 'Residence permit', 'Other']), T('fullname', 'Full name'), S('number', 'Document number'), T('country', 'Country / issuer'), D('dob', 'Date of birth'), D('issued', 'Issue date'), D('expires', 'Expiry date', { expiry: true }),
  ] },
  bank: { label: 'Bank account', plural: 'Bank', icon: '🏦', sub: 'bank', fields: [
    T('bank', 'Bank'), T('holder', 'Account holder'), S('accno', 'Account number'), T('routing', 'Routing / sort code / IBAN', { mono: true }), T('swift', 'SWIFT / BIC', { mono: true }), S('pin', 'PIN'), U('url', 'Website'), T('username', 'Username'), S('password', 'Password', { gen: true }),
  ] },
  server: { label: 'Server / API key', plural: 'Servers', icon: '🖥️', sub: 'host', fields: [
    T('host', 'Host / service'), U('url', 'Endpoint / console URL'), T('username', 'Username'), S('apikey', 'API key / token', { gen: true }), { k: 'ssh', l: 'SSH private key', kind: 'multiline', secret: true }, S('passphrase', 'Key passphrase'),
  ] },
};

export const TYPE_META = { ...CORE, ...Object.fromEntries(Object.entries(TEMPLATES).map(([k, t]) => [k, { label: t.label, icon: t.icon, plural: t.plural }])) };
export const TYPE_KEYS = Object.keys(TYPE_META);
export const isSecretField = (f) => f.kind === 'secret' || f.secret === true;
export const MAX_CUSTOM = 30;

/* Wi-Fi join QR (the format phone cameras understand): WIFI:T:WPA;S:name;P:password;; */
const esc = (s) => String(s).replace(/([\;,:"])/g, '\\$1');
export function wifiQRString(ssid, password, security) {
  const t = /^(WPA|WPA2|WPA3)$/.test(security) ? 'WPA' : security === 'WEP' ? 'WEP' : 'nopass';
  return `WIFI:T:${t};S:${esc(ssid)};${t === 'nopass' ? '' : 'P:' + esc(password) + ';'};`;
}

/* Days until a YYYY-MM-DD date (negative = past); null if unparseable. */
export function daysUntil(date, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
  const t = Date.parse(date + 'T00:00:00');
  return Number.isFinite(t) ? Math.ceil((t - now) / 864e5) : null;
}
