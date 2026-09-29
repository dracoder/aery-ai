import { MIND_DEMO } from './mind';

const KEY = 'aeryx.demo';
let cached = null;

export function isDemo() {
  if (cached !== null) return cached;
  if (typeof window === 'undefined') return false;
  const flag = new URLSearchParams(location.search).get('demo');
  try {
    if (flag === '1') localStorage.setItem(KEY, '1');
    if (flag === '0') localStorage.removeItem(KEY);
    cached = flag === '1' || (flag !== '0' && localStorage.getItem(KEY) === '1');
  } catch {
    cached = flag === '1';
  }
  return cached;
}

const MIN = 60_000;
const ago = (m) => new Date(Date.now() - m * MIN).toISOString();
const ahead = (m) => new Date(Date.now() + m * MIN).toISOString();

function seed() {
  const now = Date.now();
  return {
    confirms: [
      { id: 'c-201', question: 'Send the drafted status reply to the design review thread?', riskClass: 2, laneId: 'mail.send', ts: now, timeoutMs: 15 * MIN },
    ],
    workflows: [
      { id: 1, name: 'Morning brief', schedule: 'daily@07:30', scheduleWords: 'every day at 07:30', prompt: 'Summarise overnight news, calendar and open approvals.', purpose: 'A three-minute read before the day starts.', status: 'active', scope: [], lastOutcome: 'ok', lastRunTs: ago(95), nextRunTs: ahead(22 * 60) },
      { id: 2, name: 'Repo watch', schedule: 'every 2h', scheduleWords: 'every 2 hours', prompt: 'Check open pull requests and failing CI on watched repos.', purpose: 'Flags red builds before they sit overnight.', status: 'active', scope: ['web.read'], lastOutcome: 'ok', lastRunTs: ago(38), nextRunTs: ahead(82) },
      { id: 3, name: 'Weekly hoard review', schedule: 'weekly@sun 18:00', scheduleWords: 'Sundays at 18:00', prompt: 'Propose memory notes worth keeping from the week.', purpose: '', status: 'active', scope: [], lastOutcome: 'ok', lastRunTs: ago(60 * 26), nextRunTs: ahead(60 * 90) },
      { id: 4, name: 'Inbox triage', schedule: 'weekdays@09:00', scheduleWords: 'weekdays at 09:00', prompt: 'Sort unread mail into reply, read, archive. Draft replies; never send.', purpose: 'Drafts only — every send still asks.', status: 'proposed', scope: [], lastOutcome: null, lastRunTs: null, nextRunTs: null },
      { id: 5, name: 'Render queue sweep', schedule: 'daily@23:00', scheduleWords: 'every day at 23:00', prompt: 'Clear finished renders older than a week.', purpose: '', status: 'paused', scope: [], lastOutcome: 'ok', lastRunTs: ago(60 * 50), nextRunTs: null },
    ],
    agents: [
      { id: 1, slug: 'code-scout', description: 'Reads a repository and answers where things live.', prompt: 'You map codebases.', tools: '["read","grep","glob"]', status: 'active' },
      { id: 2, slug: 'news-analyst', description: 'Reads two to four sources and writes a sourced brief.', prompt: 'You write sourced briefs.', tools: '["web.read","web.search"]', status: 'active' },
      { id: 3, slug: 'reel-cutter', description: 'Cuts recorded footage into vertical drafts.', prompt: 'You edit video.', tools: '["media.render"]', status: 'active' },
      { id: 4, slug: 'calendar-keeper', description: 'Proposes calendar holds from threads it reads.', prompt: 'You protect focus time.', tools: '["calendar.read"]', status: 'proposed' },
    ],
    notices: [
      { id: 7, fact: 'Prefers briefs as bullet points, under 120 words.', status: 'proposed' },
    ],
    messages: [
      { role: 'user', text: 'What needs me today?', at: now - 6 * MIN },
      { role: 'assistant', text: 'Three things. One reply draft is waiting in the Chain, the Inbox triage workflow is proposed, and the morning brief ran clean at 07:30. Nothing else is asking.', at: now - 6 * MIN + 4000 },
    ],
    ops: buildOps(now),
    runs: [
      { id: 91, workflow: 'Repo watch', startedTs: ago(38), outcome: 'ok', detail: '2 PRs open · CI green' },
      { id: 90, workflow: 'Morning brief', startedTs: ago(95), outcome: 'ok', detail: 'brief delivered · 2m 40s read' },
      { id: 89, workflow: 'Repo watch', startedTs: ago(158), outcome: 'ok', detail: 'no change' },
      { id: 88, workflow: 'Repo watch', startedTs: ago(278), outcome: 'failed', detail: 'rate limited — retried next run' },
    ],
    ...MIND_DEMO.seed,
  };
}

function buildOps(now) {
  const rows = [
    ['workflow', 'workflow.run', 1, 'started', 'Morning brief started'],
    ['web.read', 'web.read', 1, 'read', '4 sources fetched for the brief'],
    ['wyrmling', 'agent.spawn', 1, 'auto', 'news-analyst flew · 38s'],
    ['hoard', 'hoard.propose', 1, 'auto', 'notice proposed: brief format'],
    ['mail.draft', 'mail.draft', 1, 'executed', 'reply drafted — not sent'],
    ['workflow', 'workflow.run', 1, 'executed', 'Repo watch · CI green'],
    ['wyrmling', 'agent.spawn', 1, 'auto', 'code-scout flew · 21s'],
  ];
  for (const extra of MIND_DEMO.opsRows) rows.splice(extra.at, 0, extra.row);
  return rows.map(([tool, lane, riskClass, verdict, detail], i) => ({
    id: 4200 + i, ts: new Date(now - (rows.length - i) * 7 * MIN).toISOString(), tool, lane, riskClass, verdict, detail,
  }));
}

const NEWS = [
  ['Chipmakers race to ship on-device AI accelerators', 'Tech Wire', 'AS', 'jp', 'tech'],
  ['Seoul unveils a public robotics testbed downtown', 'Signal Daily', 'AS', 'kr', 'global'],
  ['India expands its open data platform for startups', 'Metro Ledger', 'AS', 'in', 'national'],
  ['Researchers publish a multilingual speech model', 'Metro Ledger', 'AS', 'in', 'ai'],
  ['EU finalises guidance for general-purpose AI models', 'Continental Post', 'EU', 'be', 'ai'],
  ['Berlin startups pool compute for open research', 'Continental Post', 'EU', 'de', 'tech'],
  ['Nordic grid operators trial AI load forecasting', 'North Bulletin', 'EU', 'no', 'global'],
  ['Paris hosts a summit on energy-efficient inference', 'Signal Daily', 'EU', 'fr', 'global'],
  ['US agencies publish a framework for model evaluation', 'Capitol Brief', 'NA', 'us', 'ai'],
  ['Toronto research group releases a small reasoning model', 'Maple Wire', 'NA', 'ca', 'ai'],
  ['Satellite imagery maps wildfire risk in real time', 'Signal Daily', 'NA', 'us', 'global'],
  ['Nairobi fintechs adopt voice banking at scale', 'Savanna Times', 'AF', 'ke', 'global'],
  ['Lagos developers build Yoruba language datasets', 'Savanna Times', 'AF', 'ng', 'tech'],
  ['São Paulo deploys AI triage in public clinics', 'Southern Cross', 'SA', 'br', 'global'],
  ['Chile opens its observatory archives to researchers', 'Southern Cross', 'SA', 'cl', 'tech'],
  ['Sydney trials autonomous ferries on the harbour', 'Harbour Herald', 'OC', 'au', 'global'],
];
const COUNTRY_NAMES = { jp: 'Japan', kr: 'South Korea', in: 'India', be: 'Belgium', de: 'Germany', no: 'Norway', fr: 'France', us: 'United States', ca: 'Canada', ke: 'Kenya', ng: 'Nigeria', br: 'Brazil', cl: 'Chile', au: 'Australia' };
const NEWS_ART = ['chips-japan', 'robots-seoul', 'opendata-india', 'speech-lab', 'eu-guidance', 'compute-berlin', 'grid-nordic', 'summit-paris', 'eval-us', 'reasoning-toronto', 'wildfire-satellite', 'voicebank-nairobi', 'datasets-lagos', 'triage-saopaulo', 'observatory-chile', 'ferry-sydney'].map((slug) => `/assets/news/${slug}.webp`);

function news() {
  const categories = { global: [], national: [], tech: [], ai: [] };
  NEWS.forEach(([title, source, region, country, cat], i) => {
    const item = { title, link: '#news', source, ts: ago(9 + i * 17), image: NEWS_ART[i], region, country };
    categories[cat].push(item);
    if (cat !== 'global') categories.global.push(item);
  });
  const countries = Object.fromEntries(NEWS.map(([, , region, iso]) => [iso, { name: COUNTRY_NAMES[iso], region }]));
  return { fetchedAt: ago(4), categories, countries, errors: [] };
}

const HOARD = {
  'user.md': '# About me\n\n- Works on a few side projects at once.\n- Likes short answers and a daily summary.\n- Wants every outward action to ask first.\n',
  'learned.md': '# Learned\n\n- Prefers dark UI and terse briefs.\n- Reviews the Chain twice a day.\n- Keeps renders local until approved.\n',
  'persona.md': '# Aeryx\n\nOne mind, three forms. Calm, exact, loyal to the Chain.\nSays what it did, what it will do, and waits when it must.\n',
};

let state = null;
const S = () => (state ??= seed());

const REPLIES = [
  [/news|world/i, 'Sixteen stories mapped across six regions. The biggest cluster is AI policy in Europe; open the World signal tab for the globe.'],
  [/approv|chain|pending/i, 'One action is waiting: sending the status reply. It stays unsent until you approve it in the Chain.'],
  [/workflow|schedule|routine/i, 'Three workflows are armed. Repo watch runs next, in about an hour and a half. Inbox triage is proposed and waiting on you.'],
  [/who|what are you|aeryx/i, 'I am Aeryx: one mind, three forms. Every action I take is classified and logged, and anything outward waits for your word.'],
];
const replyFor = (text) => (REPLIES.find(([re]) => re.test(text))?.[1]) ?? 'Noted. In this demo build I answer from sample data; the live daemon routes this through the Chain.';

const listeners = new Set();
const emit = (payload) => listeners.forEach((fn) => fn({ data: JSON.stringify(payload) }));

export class DemoEventSource {
  constructor() {
    this.onmessage = null;
    this.handler = (e) => this.onmessage?.(e);
    listeners.add(this.handler);
    this.timer = setInterval(() => emit({ type: 'state' }), 20_000);
  }
  close() { listeners.delete(this.handler); clearInterval(this.timer); }
}

export const demoMessages = () => S().messages.slice();

const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
const setStatus = (list, id, status) => { const row = list.find((x) => String(x.id) === String(id)); if (row) row.status = status; };

function route(method, path, body) {
  const s = S();
  const [pathname] = path.split('?');
  const parts = pathname.split('/').filter(Boolean);
  if (method === 'GET') {
    switch (pathname) {
      case '/status': return {
        brain: 'ready', model: 'claude-sonnet-5', chainIntact: true, halted: false, haltReason: null, remote: false,
        pendingConfirms: s.confirms,
        pendingProposals: {
          workflows: s.workflows.filter((w) => w.status === 'proposed').length,
          agents: s.agents.filter((a) => a.status === 'proposed').length,
          notices: s.notices.filter((n) => n.status === 'proposed').length,
          ...MIND_DEMO.proposals(s),
        },
        ...MIND_DEMO.statusFields(s),
      };
      case '/ops': return { chainIntact: true, rows: s.ops, runs: s.runs };
      case '/usage': return { today: { inputTokens: 184_000, outputTokens: 21_500, costUsd: .42 }, todayByBasis: { estimate: .42 }, basis: 'estimate' };
      case '/workflows': return { workflows: s.workflows };
      case '/agents': return { agents: s.agents };
      case '/news': return news();
      case '/hoard': return { files: HOARD };
      case '/hoard/notices': return { notices: s.notices };
      case '/hoard/draft': return { draft: null };
      default:
        return MIND_DEMO.get(pathname, parts, s) ?? null;
    }
  }
  if (pathname === '/confirm') {
    s.confirms = s.confirms.filter((c) => c.id !== body?.id);
    s.ops.push({ id: s.ops.at(-1).id + 1, ts: new Date().toISOString(), tool: 'mail.send', lane: 'mail.send', riskClass: 2, verdict: body?.approve ? 'confirmed' : 'denied', detail: body?.approve ? 'owner approved — reply sent' : 'owner denied — nothing sent' });
    setTimeout(() => emit({ type: 'confirm' }), 50);
    return {};
  }
  if (pathname === '/ask') {
    const text = String(body?.text ?? '');
    s.messages.push({ role: 'user', text, at: Date.now() });
    setTimeout(() => {
      const reply = replyFor(text);
      s.messages.push({ role: 'assistant', text: reply, at: Date.now() });
      emit({ type: 'say', text: reply });
    }, 1100);
    return {};
  }
  const [kind, id, action] = parts;
  const entry = {
    workflows: { rows: s.workflows, event: 'workflows' },
    agents: { rows: s.agents, event: 'agents' },
    ...MIND_DEMO.tables(s),
  }[kind];
  if (entry && id && action) {
    const next = { approve: entry.approved ?? 'active', resume: 'active', pause: 'paused', retire: 'retired', revive: 'active', abandon: 'abandoned', activate: 'active', accept: 'accepted', dismiss: 'dismissed', snooze: 'snoozed' }[action];
    if (action === 'delete') { const i = entry.rows.findIndex((x) => String(x.id) === id); if (i >= 0) entry.rows.splice(i, 1); }
    else if (next) setStatus(entry.rows, id, next);
    setTimeout(() => emit({ type: entry.event }), 50);
    return {};
  }
  if (kind === 'hoard' && id === 'notices' && action) {
    const nid = parts[2]; setStatus(s.notices, nid, parts[3] === 'keep' ? 'kept' : 'dismissed');
    return {};
  }
  if (pathname === '/workflows' && body?.name) {
    s.workflows.push({ id: Date.now(), name: body.name, schedule: body.schedule, scheduleWords: body.schedule, prompt: body.prompt, purpose: '', status: 'active', scope: [], lastOutcome: null, lastRunTs: null, nextRunTs: ahead(60) });
    return {};
  }
  if (pathname === '/agents' && body?.slug) {
    s.agents.push({ id: Date.now(), slug: body.slug, description: body.description, prompt: body.prompt, tools: null, status: 'active' });
    return {};
  }
  return MIND_DEMO.post(pathname, body, s) ?? {};
}

export function demoFetch(path, init = {}) {
  const method = (init.method ?? 'GET').toUpperCase();
  let body = null;
  try { body = init.body ? JSON.parse(init.body) : null; } catch { body = null; }
  const result = route(method, path, body);
  return new Promise((resolve) => setTimeout(() => resolve(result === null ? json({ error: 'not in demo data' }, 404) : json(result)), 60));
}
