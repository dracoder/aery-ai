export function safeSourceUrl(raw: unknown): string | null {
  let u: URL;
  try { u = new URL(String(raw ?? '')); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return null;
  if (host.startsWith('[')) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && blockedAddress(host)) return null;
  return u.href;
}

export function blockedAddress(ip: string): boolean {
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i.exec(ip.trim());
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    return false;
  }
  const v6 = ip.trim().toLowerCase();
  if (!v6.includes(':')) return true;
  if (v6 === '::' || v6 === '::1') return true;
  return /^(fc|fd|fe[89ab]|ff)/.test(v6) || v6.startsWith('::ffff:');
}
