/* Deployment settings — the same Contact Admin relay and administrator as ulyOS.

   CONTACT_ENDPOINT is a Google Apps Script relay that forwards a message to the administrator's Gmail (the same relay
   ulyOS and ulyweb/key use). It is the ONLY place this app can send anything, and only when a person presses Send in
   Contact Admin, or creates / restores a profile (a disclosure is shown on that screen). Passwords, vault data and
   keys are never part of a message. Set CONTACT_ENDPOINT to '' to remove Contact Admin and the notification.

   The single-file offline copy (VaultManager-offline.html) never contacts anyone: it has no network permission for the relay. */
export const CONTACT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzvKlrt3NYoGvwIoxpOrDyarhJYL5V8TctpxuG16xw0I5ee-jcOWs1Fw_c9SSh6jI_McA/exec';
export const CONTACT_EMAIL = 'francisuadm@gmail.com';
/* email the administrator when a profile is created or restored (never on localhost or file://) */
export const NOTIFY_ON_PROFILE = true;
