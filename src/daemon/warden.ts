import path from 'node:path';

export interface BrainRunConfig {
  runAs: 'self' | 'warden';
  account: string;
  configDir: string;
  syncCredential: boolean;
}

export function readBrainRunConfig(raw: any, root: string): BrainRunConfig {
  const block = raw?.brain ?? {};
  return {
    runAs: block.runAs === 'warden' ? 'warden' : 'self',
    account: typeof block.account === 'string' && block.account.trim() ? block.account.trim() : 'aeryx-brain',
    configDir:
      typeof block.configDir === 'string' && block.configDir.trim()
        ? block.configDir.trim()
        : path.join(root, 'data', 'brain-claude'),
    syncCredential: block.syncCredential !== false,
  };
}

export function credentialSyncPlan(
  cfg: BrainRunConfig,
  homedir: string,
  hasStandingToken = false,
): { from: string; to: string } | null {
  if (cfg.runAs !== 'warden' || !cfg.syncCredential) return null;
  if (hasStandingToken) return null;
  return {
    from: path.join(homedir, '.claude', '.credentials.json'),
    to: path.join(cfg.configDir, '.credentials.json'),
  };
}

export function brainTokenPath(root: string): string {
  return path.join(root, 'secrets', 'brain-token.cred');
}

export function validStandingToken(value: unknown): boolean {
  const s = String(value ?? '');
  if (s.length < 40 || s.length > 4096) return false;
  if (/[\s"'`]/.test(s)) return false;
  return /^sk-ant-[a-z0-9-]+$/i.test(s);
}

export function brainCredentialMode(
  cfg: BrainRunConfig,
  hasStandingToken: boolean,
): 'standing' | 'copy' | 'shared' {
  if (cfg.runAs !== 'warden') return 'shared';
  if (hasStandingToken) return 'standing';
  return 'copy';
}

export interface SpawnPlan {
  command: string;
  args: string[];
  env: Record<string, string | undefined>;
}

export function brainSpawnPlan(
  cfg: BrainRunConfig,
  root: string,
  execPath: string,
  entry: string,
  baseEnv: Record<string, string | undefined>,
  bootToken: string,
  exists: (p: string) => boolean,
): SpawnPlan {
  void bootToken;
  const { AERYX_BRAIN_TOKEN: _t, AERYX_REMOTE_PIN: _p, AERYX_OPENROUTER_URL: _o, ...env }: Record<string, string | undefined> = baseEnv;
  env.AERYX_UNDER_BRAIN = '1';
  if (cfg.runAs === 'self') {
    return { command: execPath, args: [entry], env };
  }
  const warden = path.join(root, 'dist', 'warden.exe');
  const cred = path.join(root, 'secrets', 'warden.cred');
  if (!exists(warden)) throw new Error(`brain.runAs is "warden" but ${warden} is missing — run npm run build:warden (or set runAs back to "self")`);
  if (!exists(cred)) throw new Error(`brain.runAs is "warden" but ${cred} is missing — run scripts/setup-os-boundary.ps1 (or set runAs back to "self")`);
  env.CLAUDE_CONFIG_DIR = cfg.configDir;
  return { command: warden, args: ['--cred', cred, '--', execPath, entry], env };
}
