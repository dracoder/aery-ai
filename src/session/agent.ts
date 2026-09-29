import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DESKTOP_CAPABILITIES, sessionTokenPath, type Capability } from '../daemon/core';
import { runDeskCapability } from '../daemon/mind-organs';
import { deskCapabilities, deskRefusal, HEARTBEAT_MS, agentId } from './desk';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE = `http://127.0.0.1:${Number(process.env.AERYX_PORT || 23799)}`;
const ID = agentId(randomBytes(8).toString('hex'));
const supplied = String(process.env.AERYX_DESK_CALLBACK_TOKEN ?? '');
const CALLBACK_TOKEN = supplied.length >= 32 ? supplied : randomBytes(32).toString('hex');

function log(msg: string) {
  console.log(`[desk] ${msg}`);
}

function readDeskToken(): string | null {
  try {
    const t = fs.readFileSync(sessionTokenPath(ROOT), 'utf-8').trim();
    return t.length >= 32 ? t : null;
  } catch {
    return null;
  }
}

let attached = false;

async function beat(): Promise<void> {
  const token = readDeskToken();
  if (!token) {
    if (attached) { attached = false; log('core is gone — waiting for it to come back'); }
    return;
  }
  const capabilities = deskCapabilities(process.platform, isLocked());
  try {
    const res = await fetch(`${CORE}/internal/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, id: ID, capabilities, port: PORT, callbackToken: CALLBACK_TOKEN }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      if (attached) { attached = false; log(`core refused the desk (${res.status})`); }
      return;
    }
    if (!attached) {
      attached = true;
      log(`attached to core — offering ${capabilities.join(', ') || 'nothing (screen locked?)'}`);
    }
  } catch {
    if (attached) { attached = false; log('lost core — will keep trying'); }
  }
}

function isLocked(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    return fs.existsSync(path.join(ROOT, 'data', '.desk-locked'));
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  const reply = (code: number, body: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const from = req.socket.remoteAddress ?? '';
  if (!/^(::1|::ffff:127\.|127\.)/.test(from)) return reply(403, { error: 'local only' });

  let body: any = {};
  try {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
  } catch { return reply(400, { error: 'bad body' }); }

  if (String(body.token ?? '') !== CALLBACK_TOKEN) return reply(403, { error: 'not core' });

  const verb = decodeURIComponent((req.url ?? '').replace(/^\/desk\//, '').split('?')[0]);
  const cap = String(body.capability ?? '');
  if (!(DESKTOP_CAPABILITIES as readonly string[]).includes(cap)) {
    return reply(400, { error: `unknown desk capability "${cap}"` });
  }
  if (!deskCapabilities(process.platform, isLocked()).includes(cap as Capability)) {
    return reply(409, { error: deskRefusal(cap, isLocked()), retry: true });
  }

  const done = await runDeskCapability(cap, body, ROOT);
  if (done) return reply(done.code, done.body);

  return reply(501, { error: `the desk does not yet perform ${verb}`, capability: cap });
});

const PORT = Number(process.env.AERYX_DESK_PORT || 23800);

server.on('error', (e: any) => {
  console.error(`[desk] could not listen on ${PORT}: ${e?.code ?? e}`);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  log(`listening on 127.0.0.1:${PORT} as ${ID} (${os.userInfo().username})`);
  void beat();
  setInterval(() => void beat(), HEARTBEAT_MS);
});

async function detach(): Promise<void> {
  const token = readDeskToken();
  if (!token) return;
  try {
    await fetch(`${CORE}/internal/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, detach: true }),
      signal: AbortSignal.timeout(3_000),
    });
  } catch { }
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => { void detach().then(() => process.exit(0)); });
}
