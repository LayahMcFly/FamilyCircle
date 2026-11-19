'use strict';
/* Removes secrets from any text before it is printed, logged or written. It masks the exact secret values it was given and anything shaped like an Appwrite key. */
const SHAPES = [/\b(?:standard|ephemeral|dynamic)_[A-Za-z0-9]{16,}\b/g, /\b[a-f0-9]{64,}\b/gi];
function createRedactor(secrets = []) {
  const list = secrets.filter((s) => typeof s === 'string' && s.length >= 8);
  return function redact(value) {
    let s = typeof value === 'string' ? value : (value && value.message) || String(value);
    for (const x of list) s = s.split(x).join('[redacted]');
    for (const re of SHAPES) s = s.replace(re, '[redacted]');
    return s;
  };
}
module.exports = { createRedactor };
