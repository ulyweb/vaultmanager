/* Offline password-strength estimate. A heuristic, deliberately conservative:
   it starts from brute-force entropy (length × log2 of the character pool) and subtracts for the
   patterns attackers try first — common passwords, repeats, keyboard/alphabet runs, years, and
   leet-speak versions of dictionary words. Passphrases made of known words are scored per word. */

import { WORDS } from './wordlist.js';

const COMMON = new Set(('password 123456 12345678 123456789 qwerty abc123 letmein monkey dragon master sunshine iloveyou welcome admin login ' +
  'princess football baseball shadow superman trustno1 passw0rd p@ssw0rd password1 password123 qwerty123 1q2w3e4r 1qaz2wsx zaq12wsx ' +
  'qwertyuiop asdfghjkl zxcvbnm 000000 111111 121212 654321 666666 123123 123321 7777777 987654321 1234567890 changeme default secret ' +
  'summer winter spring autumn hello hello123 freedom whatever starwars batman charlie donald michael jordan harley ranger buster ' +
  'killer pepper soccer hunter ginger cheese computer internet google facebook test test123 guest root toor pass pass123 ' +
  'letmein123 welcome1 admin123 iloveyou1 monkey123 dragon123 football1 abc12345 qazwsx qwe123 mustang access flower').split(' '));

const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890', 'abcdefghijklmnopqrstuvwxyz'];
const LEET = { '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };
const WORDSET = new Set(WORDS);

function poolSize(pw) {
  let n = 0;
  if (/[a-z]/.test(pw)) n += 26;
  if (/[A-Z]/.test(pw)) n += 26;
  if (/[0-9]/.test(pw)) n += 10;
  if (/[^A-Za-z0-9]/.test(pw)) n += 33;
  return n || 1;
}

function runPenalty(pw) {
  const low = pw.toLowerCase();
  let pen = 0;
  const issues = [];
  // repeats like aaaa / abab abab
  const rep = low.match(/(.)\1{2,}/g);
  if (rep) { const chars = rep.reduce((n, r) => n + r.length - 1, 0); pen += chars * Math.log2(poolSize(pw)) * 0.9; issues.push('repeated characters'); }
  // sequences along keyboard rows / alphabet / digits (forward or backward), length >= 4
  let seq = 0;
  for (const row of ROWS) {
    for (const r of [row, [...row].reverse().join('')]) {
      for (let i = 0; i + 4 <= r.length; i++) for (let l = 4; i + l <= r.length; l++) { if (low.includes(r.slice(i, i + l))) seq = Math.max(seq, l); }
    }
  }
  if (seq >= 4) { pen += seq * Math.log2(poolSize(pw)) * 0.8; issues.push('keyboard or alphabet sequence'); }
  if (/(19|20)\d{2}/.test(pw)) { pen += 8; issues.push('contains a year'); }
  return { pen, issues };
}

export function estimate(pw) {
  pw = String(pw || '');
  if (!pw) return { bits: 0, score: 0, label: 'Empty', issues: [] };
  const low = pw.toLowerCase();
  const issues = [];

  if (COMMON.has(low)) return { bits: 3, score: 0, label: 'Very weak', issues: ['is one of the most common passwords'] };

  // passphrase made of dictionary words: score by words, not characters
  const toks = pw.split(/[^A-Za-z]+/).filter(Boolean).map((t) => t.toLowerCase().replace(/\d+$/, ''));
  if (toks.length >= 3 && toks.every((t) => WORDSET.has(t))) {
    const bits = toks.length * Math.log2(WORDS.length) + (/\d/.test(pw) ? 3 : 0);
    return finish(bits, issues);
  }

  let bits = pw.length * Math.log2(poolSize(pw));
  const { pen, issues: ri } = runPenalty(pw);
  bits -= pen; issues.push(...ri);

  // dictionary word with leet-speak / trailing digits
  const deleet = [...low].map((c) => LEET[c] || c).join('').replace(/[^a-z]/g, '');
  const stem = low.replace(/[0-9!@#$%^&*._-]+$/, '');
  if (COMMON.has(stem) || COMMON.has(deleet)) { bits = Math.min(bits, 14); issues.push('based on a common password'); }
  else if (WORDSET.has(stem) || WORDSET.has(deleet)) { bits = Math.min(bits, 22); issues.push('based on a dictionary word'); }

  if (new Set(pw).size <= Math.max(2, Math.floor(pw.length / 4))) { bits = Math.min(bits, 16); issues.push('very few distinct characters'); }
  return finish(Math.max(1, bits), issues);
}

function finish(bits, issues) {
  const score = bits < 28 ? 0 : bits < 45 ? 1 : bits < 64 ? 2 : bits < 90 ? 3 : 4;
  return { bits: Math.round(bits * 10) / 10, score, label: ['Very weak', 'Weak', 'Fair', 'Strong', 'Excellent'][score], issues };
}

/* Rough offline-attack time at 10 billion guesses/second (a well-funded GPU rig against a fast hash). */
export function crackTime(bits) {
  const secs = Math.pow(2, bits - 1) / 1e10;
  if (secs < 1) return 'instantly';
  const units = [['year', 31557600], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]];
  if (secs > 31557600 * 1e9) return 'longer than the age of the universe';
  for (const [name, s] of units) if (secs >= s) { const v = secs / s; return (v >= 1e6 ? v.toExponential(1) : Math.round(v).toLocaleString('en-US')) + ' ' + name + (Math.round(v) === 1 ? '' : 's'); }
  return 'instantly';
}
