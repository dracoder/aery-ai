export const MIND_DESKTOP_CAPABILITIES = [] as const;
export const MIND_CORE_CAPABILITIES = [] as const;
export const MIND_QUEUEABLE = [] as const;
export const MIND_RUNNERS = [] as const;
export const MIND_PLUGIN_ROOTS = [] as const;

export function mindHumanOnly(_pathname: string): boolean {
  return false;
}

export async function runDeskCapability(
  _capability: string,
  _body: Record<string, unknown>,
  _root: string,
): Promise<{ code: number; body: unknown } | null> {
  return null;
}
