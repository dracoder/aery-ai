export type ProviderKind = 'claude' | 'openrouter' | 'codex' | 'local';

export interface ProviderConfig {
  kind: ProviderKind;
  model: string;
  baseUrl?: string;
}

export interface ProviderInfo {
  kind: ProviderKind;
  label: string;
  needsSecret: boolean;
  defaultModel: string;
  experimental: boolean;
}

export const PROVIDERS: Record<ProviderKind, ProviderInfo> = {
  local: { kind: 'local', label: 'Local (Ollama)', needsSecret: false, defaultModel: 'qwen3-coder', experimental: false },
  claude: { kind: 'claude', label: 'Claude', needsSecret: false, defaultModel: 'opus', experimental: false },
  openrouter: { kind: 'openrouter', label: 'OpenRouter', needsSecret: true, defaultModel: 'anthropic/claude-sonnet-5', experimental: false },
  codex: { kind: 'codex', label: 'Codex (via OpenRouter)', needsSecret: true, defaultModel: 'openai/gpt-5.3-codex', experimental: true },
};

const OPENROUTER_URL = 'https://openrouter.ai/api';

export const PRIVACY_ENV: Record<string, string> = {
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  DISABLE_TELEMETRY: '1',
  DISABLE_ERROR_REPORTING: '1',
};
const OLLAMA_URL = 'http://127.0.0.1:11434';
const MODEL_RE = /^[A-Za-z0-9~._:/[\]-]{1,120}$/;

export function isProviderKind(k: unknown): k is ProviderKind {
  return typeof k === 'string' && Object.prototype.hasOwnProperty.call(PROVIDERS, k);
}

export const isOllamaCloudModel = (m: string): boolean => /(?:^|[:-])cloud$/i.test(String(m ?? '').trim());

export function loopbackUrl(raw: unknown): string | null {
  let u: URL;
  try { u = new URL(String(raw ?? '')); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) return null;
  if (u.username || u.password || (u.pathname !== '/' && u.pathname !== '')) return null;
  return `${u.protocol}//${u.host}`;
}

export function openRouterUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.AERYX_OPENROUTER_URL && loopbackUrl(env.AERYX_OPENROUTER_URL)) || OPENROUTER_URL;
}

export function readProviderConfig(config: any): ProviderConfig | { error: string } | null {
  const p = config?.brain?.provider;
  if (p === undefined || p === null) return null;
  const kind: unknown = p?.kind;
  if (!isProviderKind(kind)) return { error: `unknown provider "${String(kind)}"` };
  const model = typeof p.model === 'string' && p.model.trim() ? p.model.trim() : PROVIDERS[kind].defaultModel;
  if (!MODEL_RE.test(model)) return { error: 'model name has characters a model id never carries' };
  if (kind === 'local') {
    const baseUrl = p.baseUrl === undefined || p.baseUrl === '' ? OLLAMA_URL : loopbackUrl(p.baseUrl);
    if (!baseUrl) return { error: 'a local provider must be on this machine (http://127.0.0.1:port)' };
    return { kind: 'local', model, baseUrl };
  }
  return { kind, model };
}

export function providerEnv(cfg: ProviderConfig, secret: string | null): { env: Record<string, string>; model: string } | { error: string } {
  const blank = { ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', ANTHROPIC_BASE_URL: '', CLAUDE_CODE_OAUTH_TOKEN: '' };
  const s = (secret ?? '').trim();
  switch (cfg.kind) {
    case 'claude': {
      if (!s) return { env: {}, model: cfg.model };
      if (/^sk-ant-oat/.test(s)) return { env: { ...blank, CLAUDE_CODE_OAUTH_TOKEN: s }, model: cfg.model };
      if (/^sk-ant-/.test(s)) return { env: { ...blank, ANTHROPIC_API_KEY: s }, model: cfg.model };
      return { error: 'that does not look like an Anthropic key (sk-ant-...)' };
    }
    case 'openrouter':
    case 'codex':
      if (!/^sk-or-/.test(s)) return { error: 'an OpenRouter key (sk-or-...) is required' };
      return { env: { ...blank, ANTHROPIC_BASE_URL: openRouterUrl(), ANTHROPIC_AUTH_TOKEN: s }, model: cfg.model };
    case 'local': {
      const base = loopbackUrl(cfg.baseUrl ?? OLLAMA_URL);
      if (!base) return { error: 'a local provider must be on this machine' };
      return { env: { ...blank, ANTHROPIC_BASE_URL: base, ANTHROPIC_AUTH_TOKEN: 'ollama' }, model: cfg.model };
    }
    default:
      return { error: 'unknown provider' };
  }
}

export function setupNeeded(config: any, hasClaudeLogin: boolean, hasSecret: boolean): boolean {
  const p = readProviderConfig(config);
  if (p === null) return !hasClaudeLogin;
  if ('error' in p) return true;
  if (p.kind === 'claude') return !hasSecret && !hasClaudeLogin;
  return PROVIDERS[p.kind].needsSecret && !hasSecret;
}
