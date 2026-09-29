export const DEFAULT_WAKE_PHRASE = 'aeryx';

const MANGLINGS: Record<string, string[]> = {
  aeryx: ['aeryx', 'aerix', 'aryx', 'arix', 'erix', 'eryx', 'eriks?', 'erics?', 'air[\\s-]?(?:ix|x|icks|iks|ex)'],
  rise: ['rise', 'rice', 'ryse', 'rize', 'rises', 'arise'],
  up: ['up'],
  ery: ['ery', 'eri', 'erie', 'eerie', 'aery', 'airy', 'ari', 'arie', 'errie'],
};

const COMMON_OPENERS = new Set([
  'hey', 'ok', 'okay', 'yes', 'no', 'yeah', 'hi', 'hello', 'so', 'and', 'but', 'the',
  'now', 'wait', 'stop', 'please', 'well', 'um', 'uh', 'right', 'what', 'why', 'how',
]);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function wakePhraseIssue(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== 'string') return 'wake phrase must be a string';
  const phrase = raw.trim().toLowerCase();
  if (!phrase) return 'wake phrase is empty';
  if (phrase.length > 32) return 'wake phrase is too long (max 32 chars)';
  if (!/^[a-z]+(?:[\s-][a-z]+)*$/.test(phrase)) return 'wake phrase must be letters and single spaces only';
  const words = phrase.split(/[\s-]+/);
  if (words.length > 3) return 'wake phrase must be 3 words or fewer';
  if (words.length === 1 && phrase.length < 3) return 'a one-word wake phrase must be at least 3 letters';
  if (words.length === 1 && COMMON_OPENERS.has(phrase)) return `"${phrase}" starts ordinary sentences — it would wake him constantly`;
  return null;
}

export function wakePhrases(config: any): string[] {
  const raw = config?.voice?.wakePhrase ?? config?.wakePhrase;
  const list = (Array.isArray(raw) ? raw : [raw])
    .filter((p) => p != null && !wakePhraseIssue(p))
    .map((p) => String(p).trim().toLowerCase())
    .filter(Boolean);
  return list.length ? [...new Set(list)] : [DEFAULT_WAKE_PHRASE];
}

export function wakePhrase(config: any): string {
  return wakePhrases(config)[0]!;
}

export function buildWakeRe(phrases: string | string[]): RegExp {
  const alternatives = (Array.isArray(phrases) ? phrases : [phrases])
    .map((phrase) => String(phrase ?? '').trim().toLowerCase().split(/[\s-]+/).filter(Boolean))
    .filter((words) => words.length)
    .map((words) => words.map((w) => `(?:${(MANGLINGS[w] ?? [escapeRe(w)]).join('|')})`).join('[\\s,.-]*'));
  if (!alternatives.length) throw new Error('wake phrase is empty');
  alternatives.sort((a, b) => b.length - a.length);
  return new RegExp(`^\\W*(?:hey\\s+|ok\\s+)?(?:${alternatives.join('|')})\\b[\\s,.!?]*`, 'i');
}

export function wakeCue(phrase: string): string {
  return phrase === DEFAULT_WAKE_PHRASE ? 'my name' : `"${phrase}"`;
}

const AFFIRMATIVE = new Set([
  'yes', 'yeah', 'yep', 'yup', 'confirm', 'confirmed', 'approve', 'approved',
  'do it', 'go ahead', 'yes do it', 'yes go ahead', 'yes please', 'yes confirm',
]);

export function spokenApproval(text: string): boolean {
  const said = String(text).toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return AFFIRMATIVE.has(said);
}

export function voiceConfirm(text: string, laneId: string, wakeRe: RegExp): 'approve' | 'deny' | 'screen-only' | 'not-an-answer' {
  if (/^(shell\.exec|talon\.)/.test(laneId)) return 'screen-only';
  const t = String(text).trim();
  const m = t.match(wakeRe);
  if (!m) return 'not-an-answer';
  return spokenApproval(t.slice(m[0].length)) ? 'approve' : 'deny';
}
