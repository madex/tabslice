#!/usr/bin/env node
import crypto from 'node:crypto';

const password = process.argv[2];
if (!password) {
  console.error('Aufruf: npm run hash-password -- "dein-passwort"');
  process.exit(1);
}

const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(password, salt, 64, {N: 16384, r: 8, p: 1});
console.log(`ADMIN_PASSWORD_HASH=scrypt$${salt.toString('hex')}$${hash.toString('hex')}`);
