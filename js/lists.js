/* Pick-lists for category fields (see kind: 'choice' in templates.js). Every list ends with "Other…" in the editor, so nothing is ever forced:
   a name that is not here is typed in and stored as plain text. Names are kept as the brands usually write them. */

const sorted = (a) => [...new Set(a)].sort((x, y) => x.localeCompare(y, undefined, { sensitivity: 'base' }));

export const BANKS = sorted([
  'Ally Bank', 'American Express National Bank', 'Bank of America', 'Bank of the West', 'BMO', 'Capital One', 'Charles Schwab Bank', 'Chase', 'Chime', 'Citibank', 'Citizens Bank', 'Comerica Bank', 'Discover Bank', 'Fifth Third Bank', 'First Citizens BancShares', 'First Horizon', 'Goldman Sachs (Marcus)', 'Huntington National Bank', 'KeyBank', 'M&T Bank', 'Navy Federal Credit Union', 'PNC Bank', 'Regions Bank', 'Santander Bank', 'SoFi', 'SchoolsFirst FCU', 'State Employees’ Credit Union', 'Synchrony Bank', 'TD Bank', 'Truist', 'U.S. Bank', 'USAA', 'Wells Fargo', 'Varo Bank', 'Axos Bank', 'Merrill Edge', 'Fidelity (Cash Management)', 'Vanguard',
  'ANZ', 'Barclays', 'BNP Paribas', 'Commonwealth Bank', 'CIBC', 'Deutsche Bank', 'DBS Bank', 'HSBC', 'ING', 'Lloyds Bank', 'NatWest', 'NAB', 'RBC Royal Bank', 'Scotiabank', 'Standard Chartered', 'TD Canada Trust', 'UBS', 'Westpac', 'Monzo', 'Revolut', 'Wise',
  'Credit union (local)',
]);

export const WALLETS = sorted([
  'BitBox', 'Coldcard', 'Ellipal', 'GridPlus Lattice', 'Keystone', 'Ledger', 'SafePal', 'Tangem', 'Trezor',
  'Argent', 'Atomic Wallet', 'BlueWallet', 'Coinbase Wallet', 'Electrum', 'Exodus', 'MetaMask', 'Phantom', 'Rabby', 'Rainbow', 'Sparrow', 'Trust Wallet', 'Zerion', 'Wasabi', 'Muun', 'Phoenix', 'Edge', 'Guarda', 'Brave Wallet', 'Backpack',
  'Binance', 'Binance.US', 'Bitfinex', 'Bitget', 'Bitpanda', 'Bitstamp', 'Bybit', 'Cash App', 'Coinbase', 'Crypto.com', 'eToro', 'Fold', 'Gate.io', 'Gemini', 'HTX', 'KuCoin', 'Kraken', 'MEXC', 'OKX', 'PayPal / Venmo', 'River', 'Robinhood', 'Strike', 'Swan Bitcoin', 'Uphold', 'Upbit',
  'Paper wallet',
]);

export const CHAINS = sorted(['Bitcoin', 'Ethereum', 'Solana', 'Litecoin', 'XRP Ledger', 'Cardano', 'Polkadot', 'Cosmos', 'Avalanche', 'Polygon', 'BNB Chain', 'Tron', 'Dogecoin', 'Bitcoin Cash', 'Monero', 'Arbitrum', 'Optimism', 'Base', 'Stellar', 'Algorand', 'NEAR', 'TON', 'Sui', 'Aptos', 'Multiple networks']);

export const INSURERS = sorted(['Aetna', 'Allianz', 'Allstate', 'American Family', 'Amica', 'Anthem', 'AXA', 'Aviva', 'Blue Cross Blue Shield', 'Chubb', 'Cigna', 'Delta Dental', 'Erie Insurance', 'Farmers', 'GEICO', 'Humana', 'Kaiser Permanente', 'Lemonade', 'Liberty Mutual', 'MetLife', 'Mutual of Omaha', 'Nationwide', 'New York Life', 'Northwestern Mutual', 'Progressive', 'Prudential', 'State Farm', 'The Hartford', 'Travelers', 'UnitedHealthcare', 'USAA', 'Zurich', 'Medicare', 'Medicaid', 'Tricare', 'VSP', 'EyeMed', 'Pets Best', 'Trupanion', 'Hippo', 'Root', 'Esurance']);

export const HEALTH_PLANS = sorted(['Aetna', 'Ambetter', 'Anthem', 'Blue Cross Blue Shield', 'Cigna', 'Delta Dental', 'EyeMed', 'Health Net', 'Humana', 'Kaiser Permanente', 'Medicaid', 'Medicare', 'Molina Healthcare', 'Oscar Health', 'Tricare', 'UnitedHealthcare', 'VA Health Care', 'VSP', 'Guardian', 'MetLife']);

export const CARRIERS = sorted(['AT&T', 'Boost Mobile', 'Consumer Cellular', 'Cricket Wireless', 'Google Fi', 'Metro by T-Mobile', 'Mint Mobile', 'Red Pocket', 'Spectrum Mobile', 'Straight Talk', 'T-Mobile', 'Total Wireless', 'Tracfone', 'US Cellular', 'US Mobile', 'Verizon', 'Visible', 'Xfinity Mobile', 'Ultra Mobile', 'Lycamobile',
  'Bell', 'Rogers', 'Telus', 'Vodafone', 'EE', 'O2', 'Three', 'Orange', 'Telstra', 'Optus', 'Airtel', 'Jio']);

export const ISPS = sorted(['AT&T Fiber', 'Astound', 'Altice / Optimum', 'Cox', 'CenturyLink / Lumen', 'Comcast Xfinity', 'Frontier', 'Google Fiber', 'HughesNet', 'Mediacom', 'Starlink', 'Spectrum', 'T-Mobile Home Internet', 'Verizon Fios', 'Verizon 5G Home', 'Viasat', 'Windstream / Kinetic', 'WOW!', 'Ziply Fiber', 'BT', 'Virgin Media', 'Sky', 'Rogers', 'Bell', 'Telus', 'Telstra', 'Optus']);

export const TRAVEL_PROGRAMS = sorted(['Air Canada Aeroplan', 'Air France-KLM Flying Blue', 'Alaska Mileage Plan', 'American Airlines AAdvantage', 'British Airways Executive Club', 'Delta SkyMiles', 'Emirates Skywards', 'Frontier Miles', 'JetBlue TrueBlue', 'Lufthansa Miles & More', 'Qatar Privilege Club', 'Singapore KrisFlyer', 'Southwest Rapid Rewards', 'Spirit Free Spirit', 'United MileagePlus', 'Virgin Atlantic Flying Club',
  'Hilton Honors', 'IHG One Rewards', 'Marriott Bonvoy', 'World of Hyatt', 'Wyndham Rewards', 'Choice Privileges', 'Best Western Rewards', 'Radisson Rewards', 'Accor ALL',
  'Airbnb', 'Booking.com', 'Expedia', 'Hertz Gold', 'Avis Preferred', 'National Emerald Club', 'Amtrak Guest Rewards', 'Carnival', 'Royal Caribbean']);

export const CLOUD_HOSTS = sorted(['Akamai / Linode', 'Amazon Web Services', 'Cloudflare', 'DigitalOcean', 'Fly.io', 'GitHub', 'GitLab', 'Google Cloud', 'Heroku', 'Hetzner', 'IBM Cloud', 'Microsoft Azure', 'Netlify', 'Oracle Cloud', 'OVHcloud', 'Render', 'Self-hosted', 'Vercel', 'Vultr', 'Supabase', 'Firebase']);

export const TECH_SERVICES = sorted([...CLOUD_HOSTS, 'GoDaddy', 'Namecheap', 'Squarespace Domains', 'Porkbun', 'Google Workspace', 'Microsoft 365', 'Atlassian', 'Docker Hub', 'npm', 'PyPI', 'Bitbucket', 'Twilio', 'SendGrid', 'Mailgun', 'Stripe', 'PayPal Developer', 'Datadog', 'Sentry', 'MongoDB Atlas', 'NordVPN', 'ProtonVPN', 'Tailscale', '1Password', 'Okta']);

export const MEMBERSHIPS = sorted(['24 Hour Fitness', 'AAA', 'AARP', 'Amazon Prime', 'Anytime Fitness', 'BJ’s Wholesale', 'Costco', 'Disney+', 'Equinox', 'Hulu', 'LA Fitness', 'Netflix', 'Orangetheory', 'Peloton', 'Planet Fitness', 'REI Co-op', 'Sam’s Club', 'Spotify', 'Target Circle', 'Walmart+', 'YMCA', 'YouTube Premium', 'Apple One', 'Audible', 'Kroger Plus', 'Safeway Club', 'Starbucks Rewards', 'Sephora Beauty Insider', 'Ulta Ultamate', 'Marriott Bonvoy', 'Hilton Honors', 'Rotary', 'Library']);

export const US_STATES = ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming', 'Puerto Rico'];

export const PHARMACIES = sorted(['Albertsons', 'Amazon Pharmacy', 'Costco Pharmacy', 'CVS Pharmacy', 'Express Scripts', 'Optum Rx', 'Kroger Pharmacy', 'Publix Pharmacy', 'Rite Aid', 'Safeway Pharmacy', 'Sam’s Club Pharmacy', 'Target (CVS)', 'Walgreens', 'Walmart Pharmacy', 'HEB Pharmacy', 'Hy-Vee Pharmacy', 'Meijer Pharmacy', 'GoodRx', 'Capsule', 'Alto', 'Hospital pharmacy', 'Independent pharmacy']);

export const BRANDS = sorted(['Acer', 'Amazon', 'Apple', 'ASUS', 'Bose', 'Canon', 'Dell', 'Dyson', 'Fitbit', 'Garmin', 'Google', 'GoPro', 'HP', 'Huawei', 'Lenovo', 'LG', 'Microsoft', 'Nikon', 'Nintendo', 'OnePlus', 'Panasonic', 'Philips', 'Samsung', 'Sennheiser', 'Sonos', 'Sony', 'Whirlpool', 'Xiaomi', 'Bosch', 'GE', 'Honeywell', 'Ring', 'Nest']);

export const STORES = sorted(['Amazon', 'Apple Store', 'Best Buy', 'Costco', 'Dell', 'eBay', 'Etsy', 'Home Depot', 'IKEA', 'Lowe’s', 'Micro Center', 'Newegg', 'Target', 'Walmart', 'B&H Photo', 'Wayfair', 'Samsung', 'Staples', 'Adorama', 'Direct from the maker']);

export const LENS_BRANDS = sorted(['Acuvue', 'Air Optix', 'Alcon Dailies', 'Bausch + Lomb', 'Biofinity', 'Biotrue', 'Clariti', 'CooperVision', 'Dailies Total1', 'FreshLook', 'Proclear', 'Precision1', 'Ultra', 'Essilor', 'Zeiss', 'Hoya', 'Transitions']);

/* Popular sign-in pages for New login: picking one fills the website (and the title when it is empty). [name, address] */
export const POPULAR_SITES = [
  ['Google', 'https://accounts.google.com'], ['Gmail', 'https://mail.google.com'], ['YouTube', 'https://www.youtube.com'],
  ['Apple ID', 'https://account.apple.com'], ['iCloud', 'https://www.icloud.com'],
  ['Microsoft account', 'https://account.microsoft.com'], ['Outlook.com', 'https://outlook.live.com'], ['Microsoft 365', 'https://www.office.com'], ['Xbox', 'https://www.xbox.com'],
  ['Facebook', 'https://www.facebook.com'], ['Instagram', 'https://www.instagram.com'], ['WhatsApp', 'https://web.whatsapp.com'], ['Threads', 'https://www.threads.net'],
  ['X (Twitter)', 'https://x.com'], ['LinkedIn', 'https://www.linkedin.com'], ['TikTok', 'https://www.tiktok.com'], ['Snapchat', 'https://accounts.snapchat.com'], ['Pinterest', 'https://www.pinterest.com'], ['Reddit', 'https://www.reddit.com'], ['Discord', 'https://discord.com/login'],
  ['GitHub', 'https://github.com/login'], ['GitLab', 'https://gitlab.com/users/sign_in'], ['Bitbucket', 'https://bitbucket.org'], ['Docker Hub', 'https://hub.docker.com'], ['Cloudflare', 'https://dash.cloudflare.com'], ['AWS', 'https://console.aws.amazon.com'], ['Google Cloud', 'https://console.cloud.google.com'], ['Azure portal', 'https://portal.azure.com'], ['DigitalOcean', 'https://cloud.digitalocean.com'],
  ['Amazon', 'https://www.amazon.com'], ['eBay', 'https://www.ebay.com'], ['Walmart', 'https://www.walmart.com'], ['Target', 'https://www.target.com'], ['Costco', 'https://www.costco.com'], ['Best Buy', 'https://www.bestbuy.com'], ['Etsy', 'https://www.etsy.com'],
  ['PayPal', 'https://www.paypal.com'], ['Venmo', 'https://venmo.com'], ['Cash App', 'https://cash.app'], ['Zelle', 'https://www.zellepay.com'], ['Coinbase', 'https://www.coinbase.com'], ['Kraken', 'https://www.kraken.com'], ['Binance', 'https://www.binance.com'],
  ['Netflix', 'https://www.netflix.com'], ['Disney+', 'https://www.disneyplus.com'], ['Hulu', 'https://www.hulu.com'], ['Max', 'https://www.max.com'], ['Prime Video', 'https://www.primevideo.com'], ['Spotify', 'https://accounts.spotify.com'], ['Apple Music', 'https://music.apple.com'], ['Twitch', 'https://www.twitch.tv'],
  ['Steam', 'https://store.steampowered.com/login'], ['Epic Games', 'https://www.epicgames.com'], ['PlayStation', 'https://www.playstation.com'], ['Nintendo', 'https://accounts.nintendo.com'],
  ['Dropbox', 'https://www.dropbox.com/login'], ['Google Drive', 'https://drive.google.com'], ['OneDrive', 'https://onedrive.live.com'], ['Box', 'https://account.box.com/login'], ['Adobe', 'https://account.adobe.com'], ['Canva', 'https://www.canva.com'],
  ['Zoom', 'https://zoom.us/signin'], ['Slack', 'https://slack.com/signin'], ['Microsoft Teams', 'https://teams.microsoft.com'], ['Notion', 'https://www.notion.so/login'], ['Trello', 'https://trello.com/login'], ['Atlassian', 'https://id.atlassian.com'],
  ['Yahoo', 'https://login.yahoo.com'], ['Proton', 'https://account.proton.me'], ['ChatGPT / OpenAI', 'https://chatgpt.com'], ['Claude', 'https://claude.ai'],
  ['Uber', 'https://auth.uber.com'], ['Lyft', 'https://www.lyft.com'], ['DoorDash', 'https://www.doordash.com'], ['Airbnb', 'https://www.airbnb.com'], ['Booking.com', 'https://account.booking.com'],
  ['Vaultwarden / Bitwarden', 'https://vault.bitwarden.com'], ['Synology', 'https://account.synology.com'], ['Ubiquiti UniFi', 'https://account.ui.com'], ['Router admin (local)', 'http://192.168.1.1'],
].sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }));
