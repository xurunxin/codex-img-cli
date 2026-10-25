// Extract printable ASCII strings from a binary and filter by keyword.
// Used to recover the exact OAuth endpoints/parameters that Codex CLI uses,
// instead of guessing them.
import fs from 'node:fs';

const file = process.argv[2];
const keywords = process.argv.slice(3);
const buf = fs.readFileSync(file);

const MIN = 6;
let current = [];
const strings = [];
for (let i = 0; i < buf.length; i += 1) {
  const c = buf[i];
  if (c >= 0x20 && c <= 0x7e) {
    current.push(c);
  } else {
    if (current.length >= MIN) strings.push(Buffer.from(current).toString('latin1'));
    current = [];
  }
}
if (current.length >= MIN) strings.push(Buffer.from(current).toString('latin1'));

const seen = new Set();
for (const s of strings) {
  if (keywords.length && !keywords.some((k) => s.toLowerCase().includes(k.toLowerCase()))) continue;
  if (seen.has(s)) continue;
  seen.add(s);
  console.log(s);
}
