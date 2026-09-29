export type Schedule =
  | { kind: 'manual' }
  | { kind: 'every'; ms: number }
  | { kind: 'daily'; hour: number; minute: number; days: number[] | null }
  | { kind: 'monthly'; day: number; hour: number; minute: number };

const DOW: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const MIN_EVERY_MS = 60_000;
const MAX_EVERY_MS = 24 * 3_600_000;

function time(h: string, m: string): { hour: number; minute: number } | null {
  const hour = Number(h);
  const minute = Number(m);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function parseSchedule(spec: string): Schedule | null {
  const s = String(spec ?? '').trim().toLowerCase();
  if (s === 'manual') return { kind: 'manual' };

  let m = /^every\s+(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?)$/.exec(s);
  if (m) {
    const ms = Number(m[1]) * (m[2]!.startsWith('h') ? 3_600_000 : 60_000);
    if (ms < MIN_EVERY_MS || ms > MAX_EVERY_MS) return null;
    return { kind: 'every', ms };
  }

  m = /^(daily|weekdays|weekends)\s*@\s*(\d{1,2}):(\d{2})$/.exec(s);
  if (m) {
    const t = time(m[2]!, m[3]!);
    if (!t) return null;
    const days = m[1] === 'weekdays' ? [1, 2, 3, 4, 5] : m[1] === 'weekends' ? [0, 6] : null;
    return { kind: 'daily', ...t, days };
  }

  m = /^weekly\s*@\s*(sun|mon|tue|wed|thu|fri|sat)[a-z]*\s+(\d{1,2}):(\d{2})$/.exec(s);
  if (m) {
    const t = time(m[2]!, m[3]!);
    if (!t) return null;
    return { kind: 'daily', ...t, days: [DOW[m[1]!]!] };
  }

  m = /^monthly\s*@\s*(\d{1,2})\s+(\d{1,2}):(\d{2})$/.exec(s);
  if (m) {
    const day = Number(m[1]);
    const t = time(m[2]!, m[3]!);
    if (!t || day < 1 || day > 28) return null;
    return { kind: 'monthly', day, ...t };
  }

  return null;
}

export function nextRun(s: Schedule, after: Date): Date | null {
  switch (s.kind) {
    case 'manual':
      return null;
    case 'every':
      return new Date(after.getTime() + s.ms);
    case 'daily': {
      const c = new Date(after.getFullYear(), after.getMonth(), after.getDate(), s.hour, s.minute, 0, 0);
      for (let i = 0; i < 8; i++) {
        if (c.getTime() > after.getTime() && (s.days === null || s.days.includes(c.getDay()))) return c;
        c.setDate(c.getDate() + 1);
      }
      return null;
    }
    case 'monthly': {
      const c = new Date(after.getFullYear(), after.getMonth(), s.day, s.hour, s.minute, 0, 0);
      if (c.getTime() > after.getTime()) return c;
      return new Date(after.getFullYear(), after.getMonth() + 1, s.day, s.hour, s.minute, 0, 0);
    }
  }
}

function speakTime(hour: number, minute: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

export function describeSchedule(s: Schedule): string {
  switch (s.kind) {
    case 'manual':
      return 'on demand only';
    case 'every': {
      if (s.ms % 3_600_000 === 0) {
        const h = s.ms / 3_600_000;
        return h === 1 ? 'every hour' : `every ${h} hours`;
      }
      const m = Math.round(s.ms / 60_000);
      return m === 1 ? 'every minute' : `every ${m} minutes`;
    }
    case 'daily': {
      const at = speakTime(s.hour, s.minute);
      if (s.days === null) return `daily at ${at}`;
      if (s.days.length === 1) return `every ${DAY_NAMES[s.days[0]!]} at ${at}`;
      if (s.days.length === 5) return `on weekdays at ${at}`;
      return `on weekends at ${at}`;
    }
    case 'monthly':
      return `monthly on day ${s.day} at ${speakTime(s.hour, s.minute)}`;
  }
}
