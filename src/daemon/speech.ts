export const TTS_CHUNK_CHARS = 400;

export function chunkForSpeech(text: string, cap = TTS_CHUNK_CHARS): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= cap) return [trimmed];

  const out: string[] = [];
  let cur = '';

  const flush = () => {
    const c = cur.trim();
    if (c) out.push(c);
    cur = '';
  };

  for (const sentence of trimmed.match(/[^.!?\n]+(?:[.!?]+|\n+|$)/g) ?? [trimmed]) {
    for (const piece of splitLong(sentence, cap)) {
      if (cur && cur.length + piece.length > cap) flush();
      cur += piece;
    }
  }
  flush();
  return out;
}

export interface TtsClient {
  setMetadata(voice: string, format: unknown): Promise<unknown>;
  toStream(text: string): Promise<{ audioStream: AsyncIterable<Uint8Array> }>;
}

export interface TtsLoader {
  create(): Promise<TtsClient>;
  format: unknown;
}

export interface SynthesisResult {
  audio: Buffer | null;
  complete: boolean;
  chunksTotal: number;
  chunksRendered: number;
  attemptsUsed: number;
}

export const TTS_ATTEMPTS = 3;
export const TTS_TIMEOUT_MS = 15_000;

export function withTimeout<T>(p: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

async function collect(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of stream) parts.push(Buffer.from(c));
  return Buffer.concat(parts);
}

async function synthesizeChunk(
  text: string,
  loader: TtsLoader,
  opts: { voice: string; attempts: number; timeoutMs: number; onWarn?: (m: string) => void; sleep?: (ms: number) => Promise<void> },
): Promise<{ audio: Buffer | null; attempts: number }> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      const client = await loader.create();
      await client.setMetadata(opts.voice, loader.format);
      const { audioStream } = await client.toStream(text);
      const audio = await withTimeout(collect(audioStream), opts.timeoutMs, 'synthesis');
      if (!audio.length) throw new Error('empty audio stream');
      return { audio, attempts: attempt };
    } catch (e) {
      const msg = (e as Error).message;
      if (attempt === opts.attempts) {
        opts.onWarn?.(`gave up after ${opts.attempts} attempts: ${msg}`);
        return { audio: null, attempts: attempt };
      }
      opts.onWarn?.(`attempt ${attempt} failed (${msg}) — retrying`);
      await sleep(250 * attempt);
    }
  }
  return { audio: null, attempts: opts.attempts };
}

export async function synthesizeSpeech(
  text: string,
  loader: TtsLoader,
  {
    voice = 'en-US-AvaNeural',
    attempts = TTS_ATTEMPTS,
    timeoutMs = TTS_TIMEOUT_MS,
    cap = TTS_CHUNK_CHARS,
    onWarn,
    onChunk,
    sleep,
  }: {
    voice?: string; attempts?: number; timeoutMs?: number; cap?: number;
    onWarn?: (m: string) => void;
    onChunk?: (audio: Buffer, index: number, total: number) => void;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<SynthesisResult> {
  const parts = chunkForSpeech(text, cap);
  const audio: Buffer[] = [];
  let attemptsUsed = 0;
  let complete = true;

  for (const [i, part] of parts.entries()) {
    const r = await synthesizeChunk(part, loader, { voice, attempts, timeoutMs, onWarn, sleep });
    attemptsUsed += r.attempts;
    if (!r.audio) {
      onWarn?.(`dropped a chunk (${part.length} chars) — speech will be incomplete`);
      complete = false;
      break;
    }
    audio.push(r.audio);
    try { onChunk?.(r.audio, i, parts.length); } catch (e) { onWarn?.(`chunk listener threw: ${(e as Error).message}`); }
  }

  return {
    audio: audio.length ? Buffer.concat(audio) : null,
    complete,
    chunksTotal: parts.length,
    chunksRendered: audio.length,
    attemptsUsed,
  };
}

function splitLong(sentence: string, cap: number): string[] {
  if (sentence.length <= cap) return [sentence];
  const pieces: string[] = [];
  let rest = sentence;
  while (rest.length > cap) {
    const window = rest.slice(0, cap);
    const at = Math.max(
      window.lastIndexOf(', '), window.lastIndexOf('; '),
      window.lastIndexOf(': '), window.lastIndexOf(' — '),
    );
    const cut = at > cap / 3 ? at + 1 : (window.lastIndexOf(' ') > 0 ? window.lastIndexOf(' ') : cap);
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) pieces.push(rest);
  return pieces;
}
