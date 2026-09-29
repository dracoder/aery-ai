import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SECRET_RE = /^[A-Za-z0-9_\-.]{8,400}$/;
const NAME_RE = /^[a-z]{2,20}$/;

export function validSecret(s: unknown): s is string {
  return typeof s === 'string' && SECRET_RE.test(s);
}

function service(name: string): string {
  if (!NAME_RE.test(name)) throw new Error('bad secret name');
  return `aeryx.provider.${name}`;
}

function filePath(root: string, name: string, ext: string): string {
  if (!NAME_RE.test(name)) throw new Error('bad secret name');
  return path.join(root, 'secrets', `provider-${name}.${ext}`);
}

const PS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];

export function storeSecret(root: string, name: string, secret: string, platform = process.platform): void {
  if (!validSecret(secret)) throw new Error('refusing to store a malformed secret');
  if (platform === 'darwin') {
    execFileSync('security', ['-i'], {
      input: `add-generic-password -U -a aeryx -s ${service(name)} -w ${secret}\n`,
      stdio: ['pipe', 'ignore', 'pipe'], timeout: 20_000,
    });
    return;
  }
  fs.mkdirSync(path.join(root, 'secrets'), { recursive: true });
  if (platform === 'win32') {
    const blob = execFileSync('powershell.exe', [...PS,
      'Add-Type -AssemblyName System.Security;' +
      '$s=[Console]::In.ReadToEnd().Trim();' +
      '[Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect(' +
      '[Text.Encoding]::UTF8.GetBytes($s),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))'],
    { input: secret, encoding: 'utf-8', windowsHide: true, timeout: 20_000 }).trim();
    fs.writeFileSync(filePath(root, name, 'cred'), blob, 'utf-8');
    return;
  }
  const f = filePath(root, name, 'key');
  fs.writeFileSync(f, secret, { encoding: 'utf-8', mode: 0o600 });
  fs.chmodSync(f, 0o600);
}

export function readSecret(root: string, name: string, platform = process.platform): string | null {
  try {
    let out: string;
    if (platform === 'darwin') {
      out = execFileSync('security', ['find-generic-password', '-a', 'aeryx', '-s', service(name), '-w'],
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20_000 }).trim();
    } else if (platform === 'win32') {
      const f = filePath(root, name, 'cred');
      if (!fs.existsSync(f)) return null;
      out = execFileSync('powershell.exe', [...PS,
        'Add-Type -AssemblyName System.Security;' +
        '$b=[Console]::In.ReadToEnd().Trim();' +
        '[Console]::Out.Write([Text.Encoding]::UTF8.GetString(' +
        '[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($b),$null,' +
        '[Security.Cryptography.DataProtectionScope]::CurrentUser)))'],
      { input: fs.readFileSync(f, 'utf-8').trim(), encoding: 'utf-8', windowsHide: true, timeout: 20_000 }).trim();
    } else {
      const f = filePath(root, name, 'key');
      if (!fs.existsSync(f)) return null;
      out = fs.readFileSync(f, 'utf-8').trim();
    }
    return validSecret(out) ? out : null;
  } catch {
    return null;
  }
}
