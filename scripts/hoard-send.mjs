#!/usr/bin/env node

import fs from 'node:fs';

const DAEMON = process.env.AERYX_DAEMON ?? 'http://127.0.0.1:23799';
const MAX_BYTES = 64 * 1024;
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fragmentPath = args.find((a) => !a.startsWith('--'));

function die(msg) {
  console.error(`hoard-send: ${msg}`);
  process.exit(1);
}

if (!fragmentPath) die('usage: node scripts/hoard-send.mjs <fragment.md> [--dry-run]');
if (!fs.existsSync(fragmentPath)) die(`no such file: ${fragmentPath}`);

const fragment = fs.readFileSync(fragmentPath, 'utf-8').trim();
if (!fragment) die('fragment is empty — nothing to send');

const dated = new Date().toISOString().slice(0, 10);
const section = fragment.startsWith('#') ? fragment : `## Session notes — ${dated}\n\n${fragment}`;

const res = await fetch(`${DAEMON}/hoard`).catch((e) => {
  die(`daemon unreachable at ${DAEMON} (${e.message}). Start it with: npm run daemon`);
});
if (!res.ok) die(`GET /hoard returned ${res.status}`);
const { files } = await res.json();
const current = (files?.['user.md'] ?? '').replace(/\s+$/, '');

const content = `${current}\n\n${section}\n`;
const bytes = Buffer.byteLength(content, 'utf-8');
if (bytes > MAX_BYTES) {
  die(
    `result would be ${bytes} bytes, over the ${MAX_BYTES / 1024}KB Hoard cap. ` +
      `Trim the fragment, or prune older sections from user.md in the Lair first.`,
  );
}

if (dryRun) {
  console.log(`--- would append (${Buffer.byteLength(section, 'utf-8')} bytes) ---\n`);
  console.log(section);
  console.log(`\n--- user.md would go ${Buffer.byteLength(current, 'utf-8')} → ${bytes} bytes ---`);
  process.exit(0);
}

const post = await fetch(`${DAEMON}/hoard/user.md`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ content }),
}).catch((e) => die(`POST failed: ${e.message}`));

const body = await post.json().catch(() => ({}));
if (!post.ok || !body.saved) {
  die(`daemon refused (${post.status}): ${body.error ?? 'unknown reason'}`);
}

console.log(`sent — user.md is now ${bytes} bytes, logged in the chain as hoard.edit.`);
console.log('The brain re-reads memory at its next start.');
