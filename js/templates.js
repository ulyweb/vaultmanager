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

  contact: { label: 'Contact', plural: 'Contacts', icon: '👤', sub: 'phone', fields: [
    T('company', 'Company / organisation'), T('jobtitle', 'Job title'), T('phone', 'Phone', { mono: true }), T('mobile', 'Mobile', { mono: true }), T('email', 'Email'),
    SEL('relation', 'Relationship', ['Family', 'Friend', 'Colleague', 'Doctor', 'Lawyer', 'Landlord', 'Neighbour', 'Other']), D('birthday', 'Birthday'), U('url', 'Website'), { k: 'address', l: 'Address', kind: 'multiline' },
  ] },
  phone: { label: 'Phone / SIM', plural: 'Phones', icon: '📱', sub: 'number', fields: [
    T('number', 'Phone number', { mono: true }), SEL('kind', 'Type', ['Mobile', 'Landline', 'VoIP', 'eSIM']), T('carrier', 'Carrier'), T('plan', 'Plan'), T('accountno', 'Account number', { mono: true }),
    T('imei', 'IMEI', { mono: true }), T('device', 'Device'), S('unlock', 'Device passcode'), S('simpin', 'SIM PIN'), S('puk', 'PUK code'), S('voicemail', 'Voicemail PIN'), S('portpin', 'Number-transfer PIN'),
    U('url', 'Carrier account page'), T('username', 'Username'), S('password', 'Password', { gen: true }),
  ] },
  technical: { label: 'Technical account', plural: 'Technical', icon: '🧰', sub: 'service', fields: [
    T('service', 'Service / platform'), SEL('kind', 'Type', ['Cloud console', 'Database', 'Email / SMTP', 'Domain registrar', 'CI / CD', 'Git / code host', 'VPN', 'Monitoring', 'Other']), U('url', 'Console / login URL'),
    T('accountid', 'Account / project ID', { mono: true }), T('region', 'Region'), T('username', 'Username'), S('password', 'Password', { gen: true }), S('token', 'API token / secret key', { gen: true }),
    { k: 'recovery', l: 'Recovery / backup codes', kind: 'multiline', secret: true },
  ] },
  crypto: { label: 'Crypto wallet', plural: 'Crypto', icon: '🪙', sub: 'wallet', tip: 'Anyone who gets a recovery seed phrase or private key controls the funds. Keep an offline copy too, never photograph it, and avoid syncing it to devices you do not fully trust.', fields: [
    T('wallet', 'Wallet / exchange'), SEL('kind', 'Type', ['Hardware wallet', 'Software wallet', 'Exchange account', 'Paper wallet', 'Other']), T('network', 'Blockchain / network'), T('address', 'Public address', { mono: true }),
    { k: 'seed', l: 'Recovery seed phrase', kind: 'multiline', secret: true }, S('privkey', 'Private key'), S('pin', 'Wallet PIN / password', { gen: true }), S('passphrase', 'Extra passphrase (25th word)'),
    U('url', 'Website'), T('username', 'Username / email'), S('password', 'Account password', { gen: true }),
  ] },
  emergency: { label: 'Emergency numbers', plural: 'Emergency', icon: '🚨', sub: 'phone', fields: [
    T('person', 'Name'), SEL('role', 'Role', ['Emergency contact', 'Doctor', 'Hospital', 'Poison control', 'Insurance claims', 'Roadside assistance', 'Lawyer', 'Embassy / consulate', 'Other']),
    T('phone', 'Phone', { mono: true }), T('altphone', 'Alternate phone', { mono: true }), T('email', 'Email'), T('relation', 'Relationship'), T('hours', 'Hours / availability'), { k: 'address', l: 'Address', kind: 'multiline' },
  ] },
  lens: { label: 'Lens prescription', plural: 'Lens', icon: '👓', sub: 'doctor', tip: 'Tip: attach a photo of the written prescription so an optician can read it directly.', fields: [
    SEL('kind', 'For', ['Glasses', 'Contact lenses', 'Both']), T('doctor', 'Optometrist / doctor'), T('clinic', 'Clinic'), T('phone', 'Clinic phone', { mono: true }), D('exam', 'Exam date'), D('expires', 'Prescription expires', { expiry: true }),
    T('od_sph', 'Right eye (OD) — sphere', { mono: true }), T('od_cyl', 'Right eye (OD) — cylinder', { mono: true }), T('od_axis', 'Right eye (OD) — axis', { mono: true }), T('od_add', 'Right eye (OD) — add', { mono: true }),
    T('os_sph', 'Left eye (OS) — sphere', { mono: true }), T('os_cyl', 'Left eye (OS) — cylinder', { mono: true }), T('os_axis', 'Left eye (OS) — axis', { mono: true }), T('os_add', 'Left eye (OS) — add', { mono: true }),
    T('pd', 'Pupillary distance (PD)', { mono: true }), T('brand', 'Lens brand / type'), T('bc', 'Base curve (contacts)', { mono: true }), T('dia', 'Diameter (contacts)', { mono: true }),
  ] },
  membership: { label: 'Membership', plural: 'Memberships', icon: '🎟️', sub: 'org', fields: [
    T('org', 'Organisation / club'), SEL('kind', 'Type', ['Gym', 'Club', 'Loyalty / rewards', 'Professional body', 'Warehouse club', 'Airline / hotel status', 'Subscription', 'Other']), T('number', 'Member number', { mono: true }), T('level', 'Tier / level'),
    D('since', 'Member since'), D('expires', 'Expires / renews', { expiry: true }), T('phone', 'Phone', { mono: true }), U('url', 'Website'), T('username', 'Username'), S('password', 'Password', { gen: true }),
  ] },
  internet: { label: 'Internet settings', plural: 'Internet', icon: '🌐', sub: 'isp', fields: [
    T('isp', 'Provider (ISP)'), SEL('kind', 'Connection', ['Fibre', 'Cable', 'DSL', 'Mobile / 5G', 'Satellite', 'Other']), T('plan', 'Plan / speed'), T('accountno', 'Account number', { mono: true }), U('url', 'Account portal'), T('support', 'Support phone', { mono: true }),
    T('username', 'Login / PPPoE username'), S('password', 'Login / PPPoE password', { gen: true }), T('ip', 'IP address (static)', { mono: true }), T('gateway', 'Gateway', { mono: true }), T('dns', 'DNS servers', { mono: true }), T('subnet', 'Subnet mask', { mono: true }),
    T('vlan', 'VLAN / VPI-VCI', { mono: true }), T('modem', 'Modem / ONT serial', { mono: true }), D('contract', 'Contract ends', { expiry: true }),
  ] },
  prescription: { label: 'Prescription / medication', plural: 'Prescriptions', icon: '💊', sub: 'medication', tip: 'Health information is sensitive — it is encrypted like everything else here, but think twice before sharing a QR or export of it.', fields: [
    T('medication', 'Medication'), T('patient', 'Patient'), T('dose', 'Dose'), T('frequency', 'How often'), T('purpose', 'What it is for'), T('rx', 'Rx number', { mono: true }), T('prescriber', 'Prescriber'),
    T('pharmacy', 'Pharmacy'), T('pharmacyphone', 'Pharmacy phone', { mono: true }), D('filled', 'Last filled'), T('refills', 'Refills left'), D('expires', 'Refill by / expires', { expiry: true }), { k: 'warnings', l: 'Warnings / interactions', kind: 'multiline' },
  ] },
  serial: { label: 'Serial number', plural: 'Serials', icon: '🔖', sub: 'product', tip: 'Tip: attach a photo of the receipt and the label on the product — handy for warranty claims and insurance.', fields: [
    T('product', 'Product'), T('brand', 'Brand'), T('model', 'Model', { mono: true }), T('serial', 'Serial number', { mono: true }), S('license', 'Licence / activation key'), D('purchased', 'Purchased'), T('store', 'Store'), T('price', 'Price'),
    T('order', 'Order / receipt number', { mono: true }), D('warranty', 'Warranty ends', { expiry: true }), U('url', 'Support / registration page'),
  ] },
  voter: { label: 'Voter card', plural: 'Voter', icon: '🗳️', sub: 'district', tip: 'Tip: attach a photo of the front and back of the card.', fields: [
    T('fullname', 'Full name'), S('voterid', 'Voter ID number'), T('district', 'District / precinct'), T('polling', 'Polling place'), T('region', 'State / region'), D('dob', 'Date of birth'), D('registered', 'Registered on'), D('expires', 'Valid until', { expiry: true }),
  ] },
  photoid: { label: 'Picture / photo ID card', plural: 'Photo IDs', icon: '🖼️', sub: 'org', tip: 'Tip: attach clear photos of the front and back of the card — they are encrypted along with everything else.', fields: [
    SEL('kind', 'Card type', ['Student ID', 'Employee badge', 'Government ID', 'Membership card', 'Senior / concession', 'Access card', 'Other']), T('holder', 'Name on card'), T('org', 'Issued by'), S('number', 'Card / ID number'), D('issued', 'Issued'), D('expires', 'Expires', { expiry: true }),
  ] },
  library: { label: 'Library card', plural: 'Library', icon: '📚', sub: 'library', fields: [
    T('library', 'Library'), T('holder', 'Name on card'), T('cardno', 'Card number', { mono: true }), S('pin', 'PIN'), T('branch', 'Home branch'), D('expires', 'Card expires', { expiry: true }), T('phone', 'Phone', { mono: true }),
    U('url', 'Catalogue / account page'), T('username', 'Username'), S('password', 'Password', { gen: true }),
  ] },
  healthcard: { label: 'Health numbers', plural: 'Health', icon: '🏥', sub: 'provider', tip: 'Tip: attach a photo of your insurance card (front and back) for quick access at the clinic.', fields: [
    T('holder', 'Name'), SEL('kind', 'Type', ['Health insurance', 'Medicare / national health', 'Dental', 'Vision', 'Medical record', 'Other']), T('provider', 'Provider / plan'), T('memberid', 'Member / policy ID', { mono: true }), T('group', 'Group number', { mono: true }),
    S('national', 'National health number'), T('mrn', 'Medical record number', { mono: true }), SEL('blood', 'Blood type', ['A+', 'A−', 'B+', 'B−', 'AB+', 'AB−', 'O+', 'O−', 'Unknown']), T('doctor', 'Primary doctor'), T('doctorphone', 'Doctor phone', { mono: true }),
    T('pharmacy', 'Pharmacy'), D('expires', 'Coverage ends', { expiry: true }), { k: 'allergies', l: 'Allergies', kind: 'multiline' }, { k: 'conditions', l: 'Conditions / notes for responders', kind: 'multiline' }, U('url', 'Member portal'), T('username', 'Username'), S('password', 'Password', { gen: true }),
  ] },
  car: { label: 'Car / vehicle', plural: 'Cars', icon: '🚗', sub: 'vehicle', tip: 'Tip: attach a photo of the registration and insurance cards so you always have them with you.', fields: [
    T('vehicle', 'Make & model'), T('year', 'Year', { mono: true }), T('color', 'Colour'), SEL('fuel', 'Fuel', ['Petrol', 'Diesel', 'Hybrid', 'Electric', 'LPG', 'Other']), T('plate', 'Licence plate', { mono: true }), T('vin', 'VIN', { mono: true }),
    D('regexp', 'Registration expires', { expiry: true }), T('insurer', 'Insurer'), T('policy', 'Policy number', { mono: true }), D('insexp', 'Insurance expires', { expiry: true }), T('roadside', 'Roadside assistance', { mono: true }),
    D('service', 'Next service due', { expiry: true }), T('mileage', 'Mileage'), T('tires', 'Tyre size', { mono: true }), S('keycode', 'Key code / radio PIN'), T('garage', 'Garage / mechanic'),
  ] },
};

/* Categories are shown grouped by purpose (sidebar, "new item" picker, categories dialog). */
export const GROUPS = [
  ['Everyday', ['login', 'note', 'card']],
  ['Accounts & access', ['technical', 'shopping', 'app', 'server', 'computer', 'locker']],
  ['Home & devices', ['network', 'internet', 'phone', 'serial']],
  ['Money', ['bank', 'crypto', 'insurance']],
  ['IDs & documents', ['identity', 'voter', 'photoid', 'library', 'membership']],
  ['Health', ['healthcard', 'prescription', 'lens']],
  ['Travel & vehicles', ['travel', 'car']],
  ['People & emergency', ['contact', 'emergency']],
];
const ALL = { ...CORE, ...Object.fromEntries(Object.entries(TEMPLATES).map(([k, t]) => [k, { label: t.label, icon: t.icon, plural: t.plural }])) };
export const TYPE_META = Object.fromEntries(GROUPS.flatMap(([g, keys]) => keys.map((k) => [k, { ...ALL[k], group: g }])));
export const TYPE_KEYS = Object.keys(TYPE_META);
/* view ids used by the app shell — a category key must never equal one of these */
export const RESERVED_VIEWS = ['home', 'all', 'fav', 'trash', 'conflicts', 'health', 'gen', 'qr', 'beam', 'data', 'settings'];
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
