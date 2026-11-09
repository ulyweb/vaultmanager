/* Deployment settings — edit this file when you host or build VaultManager for other people.

   ADMIN_EMAIL: the administrator's address for "Contact admin" and for the optional notice when someone creates
   a profile. Leave it empty to hide those features. Each device can also set its own address in
   Settings → About → Contact admin (kept on that device only).

   A password manager that runs entirely in the browser has no server of its own, so the notice is an email that
   opens in the person's own mail app (they press Send). It contains only the profile name, app version, date and
   platform — never passwords or vault data. Truly automatic notification needs a server or mail service, which
   this app deliberately does not have. */
export const ADMIN_EMAIL = '';
