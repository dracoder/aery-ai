import { spawn } from 'node:child_process';

export function isHumanOnly(method: string | undefined, pathname: string, extra?: (pathname: string) => boolean): boolean {
  if (String(method ?? '').toUpperCase() !== 'POST') return false;
  if (extra?.(pathname)) return true;
  return (
    pathname === '/confirm' ||
    pathname === '/resume' ||
    pathname === '/auth/pin' ||
    pathname === '/setup/provider' ||
    pathname === '/setup/test' ||
    pathname === '/privacy/local-only' ||
    /^\/hoard\/[^/]+\.md$/.test(pathname) ||
    /^\/hoard\/notices\/\d+\/(keep|dismiss)$/.test(pathname) ||
    /^\/hoard\/draft\/\d+\/(apply|reject)$/.test(pathname) ||
    /^\/(workflows|agents)\/\d+\/(approve|revive)$/.test(pathname)
  );
}

export function buildPeerProbe(localPort: number, remotePort: number): string {
  const l = Math.floor(localPort);
  const r = Math.floor(remotePort);
  return (
    `$c = Get-NetTCPConnection -LocalPort ${l} -RemotePort ${r} -State Established -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
    `if ($c) { $o = (Invoke-CimMethod -InputObject (Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)") -MethodName GetOwner).User; if ($o) { Write-Output ('AERYX_OWNER:' + $o) } }`
  );
}

export function parseOwner(output: string): string | null {
  const line = String(output ?? '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => /^AERYX_OWNER:[\p{L}\p{N}._$ -]{1,256}$/u.test(s));
  return line?.slice('AERYX_OWNER:'.length).trim() || null;
}

export function loopbackPeerOwner(
  localPort: number,
  remotePort: number | undefined,
  runPs: (cmd: string) => Promise<string> = defaultRunPs,
): Promise<string | null> {
  if (!remotePort) return Promise.resolve(null);
  return runPs(buildPeerProbe(localPort, remotePort)).then(parseOwner, () => null);
}

function defaultRunPs(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    const t = setTimeout(() => { p.kill(); reject(new Error('peer probe timeout')); }, 5000);
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('exit', () => { clearTimeout(t); resolve(out); });
  });
}
