#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { createHash, createPublicKey, verify } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';

const APP = path.resolve(import.meta.dirname, '..');
const DIR = path.dirname(APP);
const WIN = process.platform === 'win32';
const PORT = 23799;
const URL_LAIR = `http://127.0.0.1:${PORT}/lair/`;
const DATA = path.join(APP, 'data');
const PIDFILE = path.join(DATA, 'aeryxd.pid');
const LOGFILE = path.join(DATA, 'aeryxd.log');
const MARKER = path.join(DIR, '.aeryx-install');
const MANIFEST = path.join(APP, '.aeryx-shipped.json');
const DEFAULT_SOURCE = 'https://github.com/dracoder/aeryx/archive/refs/heads/main.tar.gz';

const CODE = [
  'src', 'lair/app', 'lair/lib', 'lair/next.config.mjs', 'lair/package.json', 'lair/package-lock.json',
  'src-tauri', 'scripts', 'design', 'docs', 'site', '.github', '.claude-plugin',
  'package.json', 'package-lock.json', 'tsconfig.json', 'build.mjs', '.nvmrc', '.gitattributes', '.gitignore',
  'aeryx.config.json.example', 'README.md', 'LICENSE', 'SECURITY.md', 'TRADEMARKS.md', 'ASSETS.md',
  'CHANGELOG.md', 'CLA.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md',
];
const TUNABLE = ['guardrails.json', 'memory/persona.md'];
const MERGED = ['skills', 'agents'];

const say = (s = '') => process.stdout.write(s + '\n');
const fail = (s) => { process.stderr.write(`aeryx: ${s}\n`); process.exit(1); };

function nodeBinDir() {
  return path.dirname(process.execPath);
}

function childEnv() {
  return { ...process.env, NEXT_TELEMETRY_DISABLED: '1', PATH: nodeBinDir() + path.delimiter + (process.env.PATH ?? '') };
}

function npm(args, cwd) {
  const cli = [
    path.join(nodeBinDir(), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeBinDir(), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].find((p) => fs.existsSync(p));
  if (!cli) fail('npm was not found next to this Node — reinstall Aeryx');
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, env: childEnv(), stdio: 'inherit' });
  if (r.status !== 0) fail(`npm ${args.join(' ')} failed`);
}

async function daemonStatus() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/status`, { signal: AbortSignal.timeout(1500) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

function readPid() {
  try {
    const pid = Number(fs.readFileSync(PIDFILE, 'utf-8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function openBrowser(url) {
  const [cmd, args] = WIN ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => say(`open ${url} in your browser`)).unref();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TAR = WIN ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
const xmlEscape = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const desktopQuote = (v) => `"${String(v).replace(/([\\"`$])/g, '\\$1')}"`;
const psQuote = (v) => `'${String(v).replace(/'/g, "''")}'`;

async function start({ open = true } = {}) {
  if (await daemonStatus()) {
    say(`Aeryx is already running — ${URL_LAIR}`);
    if (open) openBrowser(URL_LAIR);
    return;
  }
  if (!fs.existsSync(path.join(APP, 'dist', 'aeryxd.mjs'))) fail('not built yet — run `aeryx setup`');
  fs.mkdirSync(DATA, { recursive: true });
  const log = fs.openSync(LOGFILE, 'a');
  const child = spawn(process.execPath, [path.join(APP, 'dist', 'aeryxd.mjs')], {
    cwd: APP, env: childEnv(), detached: true, stdio: ['ignore', log, log], windowsHide: true,
  });
  fs.writeFileSync(PIDFILE, String(child.pid));
  child.unref();
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    if (await daemonStatus()) {
      say(`Aeryx is running — ${URL_LAIR}`);
      if (open) openBrowser(URL_LAIR);
      return;
    }
    if (!alive(child.pid)) break;
  }
  fail(`the daemon did not come up — see ${LOGFILE}`);
}

async function stop() {
  const pid = readPid();
  if (!pid || !alive(pid)) {
    try { fs.unlinkSync(PIDFILE); } catch { }
    if (await daemonStatus()) say(`something else is serving port ${PORT} — not started by this command, left alone`);
    else say('Aeryx is not running');
    return;
  }
  if (WIN) {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    for (let i = 0; i < 20 && alive(pid); i++) await sleep(250);
  } else {
    process.kill(pid, 'SIGTERM');
    for (let i = 0; i < 20 && alive(pid); i++) await sleep(250);
    if (alive(pid)) process.kill(pid, 'SIGKILL');
  }
  try { fs.unlinkSync(PIDFILE); } catch { }
  say('Aeryx stopped');
}

async function status() {
  const s = await daemonStatus();
  if (!s) { say('Aeryx is not running — `aeryx start`'); return; }
  const model = s.setupNeeded ? 'not connected (open the Lair to set one up)' : s.provider ? `${s.provider.kind} · ${s.provider.model}` : 'Claude login';
  say(`Aeryx is running — ${URL_LAIR}`);
  say(`  brain:  ${s.brain}`);
  say(`  model:  ${model}`);
  say(`  chain:  ${s.chainIntact === false ? 'BROKEN' : s.chainIntact ? 'intact' : 'no rows yet'}`);
  if (s.windowsOnly?.length) say(`  Windows-only here: ${s.windowsOnly.join(', ')}`);
}

const ISSUES = 'https://github.com/dracoder/aeryx/issues/new';
const FEEDBACK = 'https://github.com/dracoder/aeryx/discussions/new?category=ideas';

function redact(text) {
  let t = text.split(os.homedir()).join('~');
  const user = os.userInfo().username;
  if (user && user.length > 2) t = t.replace(new RegExp(user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '<user>');
  return t
    .replace(/^(\[[\w:-]+\] [^\n←]*← ).*$/gm, '$1<your words>')
    .replace(/^(\[[\w:-]+\] compiled #\d+: ).*$/gm, '$1<your words>')
    .replace(/^(\[[\w:-]+\] [\w-]+: ).*$/gm, '$1<text>')
    .replace(/^(\[voice\] ignored \(not addressed to Aeryx\): ).*$/gm, '$1<your words>')
    .replace(/^(\[voice:err\] \[stt\] ).*$/gm, '$1<your words>')
    .replace(/sk-(ant|or)-[A-Za-z0-9_-]{6,}/g, 'sk-$1-<redacted>')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b/g, '<redacted>')
    .replace(/(bearer\s+)[A-Za-z0-9._-]{8,}/gi, '$1<redacted>')
    .replace(/((?:token|secret|password|passwd|pin|api[_-]?key)["']?\s*[:=]\s*["']?)[^\s"',;]{4,}/gi, '$1<redacted>')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '<hash>')
    .replace(/[A-Za-z0-9+_-]{40,}={0,2}/g, '<blob>');
}

async function report(flags) {
  const version = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf-8')).version;
  const s = await daemonStatus();
  const where = flags.has('--from-app') ? 'Desktop app (beta)' : 'Web version (browser)';
  const provider = s?.provider ? `${s.provider.kind} ${s.provider.model}` : s?.setupNeeded ? 'not connected' : s ? 'Claude login' : 'daemon not running';
  const osName = `${process.platform} ${os.release()} ${process.arch}`;
  const tail = fs.existsSync(LOGFILE) ? fs.readFileSync(LOGFILE, 'utf-8').split('\n').slice(-80).join('\n') : '(no log yet)';
  const body = [
    'Aeryx diagnostics. Nothing was sent anywhere. Read it before you share it.',
    '',
    `version:   ${version}`,
    `system:    ${osName}`,
    `node:      ${process.version}`,
    `install:   ${DIR}`,
    `desktop:   ${desktopAppPresent() ? 'installed' : 'not installed'}`,
    `daemon:    ${s ? `running, brain ${s.brain}, up ${s.uptimeSec}s` : 'not running'}`,
    `model:     ${provider}`,
    `chain:     ${s ? (s.chainIntact === false ? 'BROKEN' : s.chainIntact ? 'intact' : 'no rows yet') : 'unknown'}`,
    `halted:    ${s?.halted ? 'yes' : 'no'}`,
    `win-only:  ${s?.windowsOnly?.join(', ') || 'none'}`,
    '',
    '--- last 80 lines of the daemon log ---',
    tail,
  ].join('\n');
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const file = path.join(os.homedir(), `aeryx-report-${stamp}.txt`);
  fs.writeFileSync(file, redact(body) + '\n');
  const env = `v${version} · ${osName} · ${provider}`;
  const url = `${ISSUES}?template=bug.yml&where=${encodeURIComponent(where)}&env=${encodeURIComponent(redact(env))}`;
  say(`Diagnostics written to ${file}. Keys, paths, your user name and what you said are masked, but read it before you share it.`);
  say(`Report the bug at: ${url}`);
  if (!flags.has('--no-open')) openBrowser(url);
}

function logs() {
  if (!fs.existsSync(LOGFILE)) { say('no log yet'); return; }
  say(fs.readFileSync(LOGFILE, 'utf-8').split('\n').slice(-60).join('\n'));
}

function setup() {
  say('Installing dependencies…');
  npm(['ci', '--no-audit', '--no-fund'], APP);
  npm(['ci', '--no-audit', '--no-fund'], path.join(APP, 'lair'));
  say('Building…');
  npm(['run', 'build'], APP);
  npm(['run', 'build:lair'], APP);
  writeManifest(APP);
  say('Built.');
}

const sha = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function writeManifest(root) {
  const m = { files: {}, dirs: {} };
  for (const f of TUNABLE) if (fs.existsSync(path.join(root, f))) m.files[f] = sha(path.join(root, f));
  for (const d of MERGED) m.dirs[d] = fs.existsSync(path.join(root, d)) ? fs.readdirSync(path.join(root, d)) : [];
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + '\n');
}

const RELEASE = process.env.AERYX_RELEASE || 'https://github.com/dracoder/aeryx/releases/latest/download';

async function download(url) {
  if (url.startsWith('file://')) {
    const f = new URL(url);
    return fs.existsSync(f) ? fs.readFileSync(f) : null;
  }
  const r = await fetch(url).catch(() => null);
  return r?.ok ? Buffer.from(await r.arrayBuffer()) : null;
}

const RELEASE_KEYS = ['BrGv7gJgfFwCNYb+Bv1SHoBiVkkIHLUvzhuQT4RC05Q='];

function signedByRelease(data, sigB64) {
  const sig = Buffer.from(String(sigB64).trim(), 'base64');
  return RELEASE_KEYS.some((k) => verify(null, data, createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(k, 'base64')]), format: 'der', type: 'spki',
  }), sig));
}

async function releaseSource() {
  const sums = await download(`${RELEASE}/SHA256SUMS`);
  if (!sums) return null;
  const sig = await download(`${RELEASE}/SHA256SUMS.sig`);
  if (!sig || !signedByRelease(sums, sig.toString('utf-8'))) fail('the release signature is not valid, so nothing was changed');
  const tar = await download(`${RELEASE}/aeryx-source.tar.gz`);
  if (!tar) return null;
  const line = sums.toString('utf-8').split('\n').find((l) => l.trim().endsWith(' aeryx-source.tar.gz'));
  const expected = line?.trim().split(/\s+/)[0];
  if (!expected || createHash('sha256').update(tar).digest('hex') !== expected) fail('the release source failed its checksum, so nothing was changed');
  return tar;
}

async function fetchSource(dest) {
  if (!process.env.AERYX_SOURCE) {
    say('Checking the latest release…');
    const tar = await releaseSource();
    if (tar) {
      const archive = path.join(dest, '..', 'source.tar.gz');
      fs.writeFileSync(archive, tar);
      fs.mkdirSync(dest, { recursive: true });
      const r = spawnSync(TAR, ['-xzf', archive, '-C', dest, '--strip-components=1'], { stdio: 'inherit' });
      if (r.status !== 0) fail('could not unpack the source archive');
      return;
    }
    say('No release yet, so updating from the development branch.');
  }
  const src = process.env.AERYX_SOURCE || DEFAULT_SOURCE;
  if (fs.existsSync(src) && fs.statSync(src).isDirectory()) {
    fs.cpSync(src, dest, { recursive: true, filter: (p) => !/[\\/](node_modules|\.git|dist|data|backups|secrets)([\\/]|$)/.test(p.slice(src.length)) });
    return;
  }
  let archive = src;
  if (/^https:\/\//.test(src)) {
    say(`Downloading ${src}`);
    const r = await fetch(src);
    if (!r.ok) fail(`download failed (${r.status})`);
    archive = path.join(dest, '..', 'source.tar.gz');
    fs.writeFileSync(archive, Buffer.from(await r.arrayBuffer()));
  }
  fs.mkdirSync(dest, { recursive: true });
  const r = spawnSync(TAR, ['-xzf', archive, '-C', dest, '--strip-components=1'], { stdio: 'inherit' });
  if (r.status !== 0) fail('could not unpack the source archive');
}

async function update() {
  const wasRunning = !!(await daemonStatus());
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'aeryx-update-'));
  const fresh = path.join(staging, 'src');
  await fetchSource(fresh);
  if (!fs.existsSync(path.join(fresh, 'scripts', 'aeryx-cli.mjs'))) fail('the downloaded source is not an Aeryx release');
  const old = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf-8')) : { files: {}, dirs: {} };

  if (wasRunning) await stop();
  for (const rel of CODE) {
    const to = path.join(APP, rel);
    fs.rmSync(to, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    if (fs.existsSync(path.join(fresh, rel))) fs.cpSync(path.join(fresh, rel), to, { recursive: true });
  }
  const kept = [];
  for (const rel of TUNABLE) {
    const mine = path.join(APP, rel);
    const theirs = path.join(fresh, rel);
    if (!fs.existsSync(theirs)) continue;
    if (fs.existsSync(mine) && old.files[rel] && sha(mine) !== old.files[rel]) {
      fs.copyFileSync(theirs, mine + '.new');
      kept.push(rel);
    } else {
      fs.mkdirSync(path.dirname(mine), { recursive: true });
      fs.copyFileSync(theirs, mine);
    }
  }
  for (const dir of MERGED) {
    const shippedBefore = new Set(old.dirs[dir] ?? []);
    const theirs = path.join(fresh, dir);
    const mine = path.join(APP, dir);
    fs.mkdirSync(mine, { recursive: true });
    for (const name of shippedBefore) {
      if (name !== path.basename(name) || name === '.' || name === '..') continue;
      if (!fs.existsSync(path.join(theirs, name))) fs.rmSync(path.join(mine, name), { recursive: true, force: true });
    }
    if (fs.existsSync(theirs)) {
      for (const name of fs.readdirSync(theirs)) {
        fs.rmSync(path.join(mine, name), { recursive: true, force: true });
        fs.cpSync(path.join(theirs, name), path.join(mine, name), { recursive: true });
      }
    }
  }
  fs.rmSync(staging, { recursive: true, force: true });
  setup();
  for (const rel of kept) say(`kept your ${rel}; the new shipped version is next to it as ${rel}.new`);
  if (wasRunning) await start({ open: false });
  say('Aeryx is up to date.');
}

const LAUNCH_AGENT = path.join(os.homedir(), 'Library', 'LaunchAgents', 'dev.aeryx.daemon.plist');
const XDG_AUTOSTART = path.join(os.homedir(), '.config', 'autostart', 'aeryx.desktop');
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUN_VALUE = 'AeryxDaemon';
const CLI = path.join(APP, 'scripts', 'aeryx-cli.mjs');

function autostart(mode) {
  if (mode !== 'on' && mode !== 'off') fail('usage: aeryx autostart on|off');
  const on = mode === 'on';
  if (WIN) {
    const r = on
      ? spawnSync('reg', ['add', RUN_KEY, '/v', RUN_VALUE, '/t', 'REG_SZ', '/d', `powershell.exe -NoProfile -WindowStyle Hidden -Command "& ${psQuote(process.execPath)} ${psQuote(CLI)} start --no-open"`, '/f'], { stdio: 'ignore' })
      : spawnSync('reg', ['delete', RUN_KEY, '/v', RUN_VALUE, '/f'], { stdio: 'ignore' });
    if (on && r.status !== 0) fail('could not write the login entry');
  } else if (process.platform === 'darwin') {
    spawnSync('launchctl', ['unload', LAUNCH_AGENT], { stdio: 'ignore' });
    if (on) {
      fs.mkdirSync(path.dirname(LAUNCH_AGENT), { recursive: true });
      fs.writeFileSync(LAUNCH_AGENT, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dev.aeryx.daemon</string>
  <key>ProgramArguments</key><array><string>${xmlEscape(process.execPath)}</string><string>${xmlEscape(CLI)}</string><string>start</string><string>--no-open</string></array>
  <key>RunAtLoad</key><true/>
</dict></plist>
`);
      spawnSync('launchctl', ['load', LAUNCH_AGENT], { stdio: 'ignore' });
    } else {
      fs.rmSync(LAUNCH_AGENT, { force: true });
    }
  } else if (on) {
    fs.mkdirSync(path.dirname(XDG_AUTOSTART), { recursive: true });
    fs.writeFileSync(XDG_AUTOSTART, `[Desktop Entry]\nType=Application\nName=Aeryx\nExec=${desktopQuote(process.execPath)} ${desktopQuote(CLI)} start --no-open\nX-GNOME-Autostart-enabled=true\n`);
  } else {
    fs.rmSync(XDG_AUTOSTART, { force: true });
  }
  say(on ? 'Aeryx will start when you log in.' : 'Aeryx will no longer start at login.');
}

const APP_MAC_RECORDED = (() => {
  try { return fs.readFileSync(path.join(DIR, '.aeryx-app'), 'utf-8').trim() || null; } catch { return null; }
})();

function isAeryxBundle(p) {
  try {
    if (path.basename(p) !== 'Aeryx.app' || !fs.lstatSync(p).isDirectory()) return false;
    return /<key>CFBundleIdentifier<\/key>\s*<string>dev\.aeryx\.desktop<\/string>/.test(fs.readFileSync(path.join(p, 'Contents', 'Info.plist'), 'utf-8'));
  } catch { return false; }
}

function macApps() {
  if (process.platform !== 'darwin') return [];
  const candidates = [APP_MAC_RECORDED, path.join(os.homedir(), 'Applications', 'Aeryx.app'), '/Applications/Aeryx.app'].filter(Boolean);
  return [...new Set(candidates.map((p) => path.resolve(p)))].filter(isAeryxBundle);
}
const APP_WIN_DIR = path.join(process.env.LOCALAPPDATA ?? '', 'Aeryx');

const WIN_PATH_REMOVE = [
  "$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)",
  "$p = $k.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)",
  "$k.SetValue('Path', ((($p -split ';') | Where-Object { $_ -and $_ -ne $env:AERYX_BIN }) -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)",
  "[Environment]::SetEnvironmentVariable('AERYX_PATH_REFRESH', '1', 'User'); [Environment]::SetEnvironmentVariable('AERYX_PATH_REFRESH', $null, 'User')",
].join('; ');

function desktopAppPresent() {
  return macApps().length > 0 || (WIN && fs.existsSync(path.join(APP_WIN_DIR, 'uninstall.exe')));
}

function removeDesktopApp() {
  const apps = macApps();
  if (apps.length) spawnSync('osascript', ['-e', 'quit app "Aeryx"'], { stdio: 'ignore' });
  for (const p of apps) {
    try {
      fs.rmSync(p, { recursive: true, force: true });
      say(`Removed ${p}`);
    } catch {
      say(`Could not remove ${p}; drag it to the Trash`);
    }
  }
  if (APP_MAC_RECORDED && process.platform === 'darwin' && fs.existsSync(APP_MAC_RECORDED) && !isAeryxBundle(APP_MAC_RECORDED)) {
    say(`Left ${APP_MAC_RECORDED} alone: not an Aeryx app bundle`);
  }
  const uninstaller = path.join(APP_WIN_DIR, 'uninstall.exe');
  if (WIN && fs.existsSync(uninstaller)) {
    spawnSync('taskkill', ['/IM', 'Aeryx.exe', '/F'], { stdio: 'ignore' });
    spawnSync('cmd', ['/d', '/s', '/c', `""${uninstaller}" /S _?=${APP_WIN_DIR}"`], { stdio: 'ignore', windowsVerbatimArguments: true, windowsHide: true });
    fs.rmSync(uninstaller, { force: true });
    say('Removed the Aeryx desktop app');
  }
}

async function uninstall(flags) {
  if (!fs.existsSync(MARKER)) fail(`${DIR} was not created by the Aeryx installer — refusing to delete it`);
  if (!flags.has('--yes')) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`This removes ${DIR}${desktopAppPresent() ? ` and the Aeryx desktop app${macApps().length ? ` (${macApps().join(', ')})` : ''}` : ''}${flags.has('--keep-data') ? ' (your data is copied out first)' : ', including your data, memory and audit log'}. Type "remove" to continue: `);
    rl.close();
    if (answer.trim() !== 'remove') { say('Nothing removed.'); return; }
  }
  await stop();
  autostart('off');
  if (flags.has('--keep-data')) {
    const keep = path.join(os.homedir(), `aeryx-data-${new Date().toISOString().slice(0, 10)}`);
    for (const rel of ['data', 'memory', 'backups', 'secrets', 'aeryx.config.json', 'guardrails.json']) {
      if (fs.existsSync(path.join(APP, rel))) fs.cpSync(path.join(APP, rel), path.join(keep, rel), { recursive: true });
    }
    say(`Your data was copied to ${keep}`);
  }
  removeDesktopApp();
  if (process.platform === 'darwin') {
    for (const kind of ['claude', 'openrouter', 'local', 'codex']) {
      spawnSync('security', ['delete-generic-password', '-a', 'aeryx', '-s', `aeryx.provider.${kind}`], { stdio: 'ignore' });
    }
  }
  if (WIN) {
    const bin = path.join(DIR, 'bin');
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_PATH_REMOVE], { stdio: 'ignore', windowsHide: true, env: { ...process.env, AERYX_BIN: bin } });
    const parent = path.dirname(DIR) === APP_WIN_DIR ? ` & rmdir "${APP_WIN_DIR}"` : '';
    spawn('cmd', ['/d', '/s', '/c', `"ping 127.0.0.1 -n 3 > nul & rmdir /s /q "${DIR}"${parent}"`], {
      detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true, cwd: os.tmpdir(),
    }).unref();
  } else {
    const link = path.join(os.homedir(), '.local', 'bin', 'aeryx');
    try { if (fs.readlinkSync(link).startsWith(DIR)) fs.unlinkSync(link); } catch { }
    fs.rmSync(DIR, { recursive: true, force: true });
  }
  say('Aeryx has been removed.');
}

const [cmd = 'help', ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const noOpen = flags.has('--no-open') || process.env.AERYX_NO_OPEN === '1';

if (process.env.AERYX_UNDER_BRAIN === '1' && ['start', 'stop', 'restart', 'setup', 'update', 'autostart', 'uninstall'].includes(cmd)) {
  fail(`\`aeryx ${cmd}\` changes the install, so it only runs from your own terminal, not from inside Aeryx`);
}

switch (cmd) {
  case 'start': await start({ open: !noOpen }); break;
  case 'stop': await stop(); break;
  case 'restart': await stop(); await start({ open: !noOpen }); break;
  case 'status': await status(); break;
  case 'open': openBrowser(URL_LAIR); break;
  case 'logs': logs(); break;
  case 'setup': setup(); break;
  case 'update': await update(); break;
  case 'autostart': autostart(rest[0]); break;
  case 'uninstall': await uninstall(flags); break;
  case 'report': await report(flags); break;
  case 'feedback': say(`Opening ${FEEDBACK}`); openBrowser(FEEDBACK); break;
  case 'version': say(JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf-8')).version); break;
  default:
    say(`aeryx — your local AI daemon

  aeryx start [--no-open]   start Aeryx and open the Lair
  aeryx stop                stop it
  aeryx restart             stop, then start
  aeryx status              is it running, which model, is the chain intact
  aeryx open                open the Lair in your browser
  aeryx logs                the last lines of the daemon log
  aeryx update              get the latest version (your data is kept)
  aeryx autostart on|off    start at login
  aeryx report              write a diagnostics file and open a bug report
  aeryx feedback            share an idea or impression
  aeryx uninstall [--keep-data] [--yes]
  aeryx version`);
}
