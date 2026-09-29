import { createPrivateKey, sign } from 'node:crypto';
import fs from 'node:fs';

const file = process.argv[2];
const pem = process.env.AERYX_RELEASE_KEY;
if (!file || !pem) {
  console.error('usage: AERYX_RELEASE_KEY=<pem> node scripts/sign-release.mjs <SHA256SUMS>');
  process.exit(1);
}
fs.writeFileSync(`${file}.sig`, sign(null, fs.readFileSync(file), createPrivateKey(pem)).toString('base64') + '\n');
console.log(`signed ${file}`);
