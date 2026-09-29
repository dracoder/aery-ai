export type NewsCategory = 'global' | 'national' | 'tech' | 'ai';

export type NewsRegion = 'NA' | 'SA' | 'EU' | 'AS' | 'AF' | 'OC';
export const REGIONS: NewsRegion[] = ['NA', 'SA', 'EU', 'AS', 'AF', 'OC'];

type CountrySpec = { name: string; region: NewsRegion; aliases?: string[]; acronyms?: string[] };
export const COUNTRIES: Record<string, CountrySpec> = {
  us: { name: 'USA', region: 'NA', aliases: ['United States', 'America’s', "America's"], acronyms: ['US', 'U.S.', 'USA'] },
  ca: { name: 'Canada', region: 'NA' },
  gl: { name: 'Greenland', region: 'NA' },
  mx: { name: 'Mexico', region: 'SA' }, gt: { name: 'Guatemala', region: 'SA' },
  bz: { name: 'Belize', region: 'SA' }, sv: { name: 'El Salvador', region: 'SA' },
  hn: { name: 'Honduras', region: 'SA' }, ni: { name: 'Nicaragua', region: 'SA' },
  cr: { name: 'Costa Rica', region: 'SA' }, pa: { name: 'Panama', region: 'SA' },
  cu: { name: 'Cuba', region: 'SA' }, ht: { name: 'Haiti', region: 'SA' },
  do: { name: 'Dominican Republic', region: 'SA' }, jm: { name: 'Jamaica', region: 'SA' },
  bs: { name: 'Bahamas', region: 'SA' }, tt: { name: 'Trinidad and Tobago', region: 'SA' },
  bb: { name: 'Barbados', region: 'SA' }, pr: { name: 'Puerto Rico', region: 'SA' },
  co: { name: 'Colombia', region: 'SA' }, ve: { name: 'Venezuela', region: 'SA' },
  gy: { name: 'Guyana', region: 'SA' }, sr: { name: 'Suriname', region: 'SA' },
  ec: { name: 'Ecuador', region: 'SA' }, pe: { name: 'Peru', region: 'SA' },
  br: { name: 'Brazil', region: 'SA' }, bo: { name: 'Bolivia', region: 'SA' },
  py: { name: 'Paraguay', region: 'SA' }, uy: { name: 'Uruguay', region: 'SA' },
  ar: { name: 'Argentina', region: 'SA' }, cl: { name: 'Chile', region: 'SA' },
  gb: { name: 'UK', region: 'EU', aliases: ['United Kingdom', 'Britain', 'England', 'Scotland', 'Wales', 'Northern Ireland'], acronyms: ['UK', 'U.K.'] },
  ie: { name: 'Ireland', region: 'EU' }, fr: { name: 'France', region: 'EU' },
  de: { name: 'Germany', region: 'EU' }, es: { name: 'Spain', region: 'EU' },
  pt: { name: 'Portugal', region: 'EU' }, it: { name: 'Italy', region: 'EU' },
  ch: { name: 'Switzerland', region: 'EU' }, at: { name: 'Austria', region: 'EU' },
  be: { name: 'Belgium', region: 'EU' }, nl: { name: 'Netherlands', region: 'EU', aliases: ['Holland', 'Dutch'] },
  lu: { name: 'Luxembourg', region: 'EU' }, dk: { name: 'Denmark', region: 'EU' },
  no: { name: 'Norway', region: 'EU' }, se: { name: 'Sweden', region: 'EU' },
  fi: { name: 'Finland', region: 'EU' }, is: { name: 'Iceland', region: 'EU' },
  ee: { name: 'Estonia', region: 'EU' }, lv: { name: 'Latvia', region: 'EU' },
  lt: { name: 'Lithuania', region: 'EU' }, pl: { name: 'Poland', region: 'EU' },
  cz: { name: 'Czechia', region: 'EU', aliases: ['Czech Republic'] },
  sk: { name: 'Slovakia', region: 'EU' }, hu: { name: 'Hungary', region: 'EU' },
  ro: { name: 'Romania', region: 'EU' }, bg: { name: 'Bulgaria', region: 'EU' },
  gr: { name: 'Greece', region: 'EU' }, cy: { name: 'Cyprus', region: 'EU' },
  mt: { name: 'Malta', region: 'EU' }, si: { name: 'Slovenia', region: 'EU' },
  hr: { name: 'Croatia', region: 'EU' }, ba: { name: 'Bosnia', region: 'EU', aliases: ['Bosnia and Herzegovina'] },
  rs: { name: 'Serbia', region: 'EU' }, me: { name: 'Montenegro', region: 'EU' },
  mk: { name: 'North Macedonia', region: 'EU' }, al: { name: 'Albania', region: 'EU' },
  xk: { name: 'Kosovo', region: 'EU' }, md: { name: 'Moldova', region: 'EU' },
  ua: { name: 'Ukraine', region: 'EU' }, by: { name: 'Belarus', region: 'EU' },
  ru: { name: 'Russia', region: 'AS' },
  cn: { name: 'China', region: 'AS', aliases: ['Beijing says', 'Hong Kong', 'Taiwan Strait'] },
  in: { name: 'India', region: 'AS' },
  jp: { name: 'Japan', region: 'AS' },
  kr: { name: 'South Korea', region: 'AS', aliases: ['Korea’s', "Korea's", 'Seoul'] },
  kp: { name: 'North Korea', region: 'AS', aliases: ['Pyongyang'] },
  mn: { name: 'Mongolia', region: 'AS' }, tw: { name: 'Taiwan', region: 'AS' },
  kz: { name: 'Kazakhstan', region: 'AS' }, kg: { name: 'Kyrgyzstan', region: 'AS' },
  tj: { name: 'Tajikistan', region: 'AS' }, tm: { name: 'Turkmenistan', region: 'AS' },
  uz: { name: 'Uzbekistan', region: 'AS' }, af: { name: 'Afghanistan', region: 'AS' },
  pk: { name: 'Pakistan', region: 'AS' }, bd: { name: 'Bangladesh', region: 'AS' },
  lk: { name: 'Sri Lanka', region: 'AS' }, np: { name: 'Nepal', region: 'AS' },
  bt: { name: 'Bhutan', region: 'AS' }, mv: { name: 'Maldives', region: 'AS' },
  mm: { name: 'Myanmar', region: 'AS', aliases: ['Burma'] },
  th: { name: 'Thailand', region: 'AS' }, la: { name: 'Laos', region: 'AS' },
  vn: { name: 'Vietnam', region: 'AS' }, kh: { name: 'Cambodia', region: 'AS' },
  my: { name: 'Malaysia', region: 'AS' }, sg: { name: 'Singapore', region: 'AS' },
  id: { name: 'Indonesia', region: 'AS' }, ph: { name: 'Philippines', region: 'AS' },
  bn: { name: 'Brunei', region: 'AS' }, tl: { name: 'Timor-Leste', region: 'AS', aliases: ['East Timor'] },
  tr: { name: 'Turkey', region: 'AS', aliases: ['Türkiye'] },
  ge: { name: 'Georgia', region: 'AS' }, am: { name: 'Armenia', region: 'AS' },
  az: { name: 'Azerbaijan', region: 'AS' }, ir: { name: 'Iran', region: 'AS' },
  iq: { name: 'Iraq', region: 'AS' }, sy: { name: 'Syria', region: 'AS' },
  lb: { name: 'Lebanon', region: 'AS' }, il: { name: 'Israel', region: 'AS' },
  ps: { name: 'Palestine', region: 'AS', aliases: ['Gaza', 'West Bank'] },
  jo: { name: 'Jordan', region: 'AS' }, sa: { name: 'Saudi Arabia', region: 'AS' },
  ye: { name: 'Yemen', region: 'AS' }, om: { name: 'Oman', region: 'AS' },
  ae: { name: 'UAE', region: 'AS', aliases: ['United Arab Emirates', 'Dubai', 'Abu Dhabi'], acronyms: ['UAE'] },
  qa: { name: 'Qatar', region: 'AS' }, bh: { name: 'Bahrain', region: 'AS' },
  kw: { name: 'Kuwait', region: 'AS' },
  dz: { name: 'Algeria', region: 'AF' }, ao: { name: 'Angola', region: 'AF' },
  bj: { name: 'Benin', region: 'AF' }, bw: { name: 'Botswana', region: 'AF' },
  bf: { name: 'Burkina Faso', region: 'AF' }, bi: { name: 'Burundi', region: 'AF' },
  cm: { name: 'Cameroon', region: 'AF' }, cv: { name: 'Cape Verde', region: 'AF' },
  cf: { name: 'Central African Republic', region: 'AF' }, td: { name: 'Chad', region: 'AF' },
  cg: { name: 'Congo', region: 'AF' }, cd: { name: 'DR Congo', region: 'AF', aliases: ['Democratic Republic of Congo', 'Democratic Republic of the Congo'], acronyms: ['DRC'] },
  ci: { name: 'Ivory Coast', region: 'AF', aliases: ['Côte d’Ivoire', "Cote d'Ivoire"] },
  dj: { name: 'Djibouti', region: 'AF' }, eg: { name: 'Egypt', region: 'AF' },
  gq: { name: 'Equatorial Guinea', region: 'AF' }, er: { name: 'Eritrea', region: 'AF' },
  et: { name: 'Ethiopia', region: 'AF' }, ga: { name: 'Gabon', region: 'AF' },
  gm: { name: 'Gambia', region: 'AF' }, gh: { name: 'Ghana', region: 'AF' },
  gn: { name: 'Guinea', region: 'AF' }, gw: { name: 'Guinea-Bissau', region: 'AF' },
  ke: { name: 'Kenya', region: 'AF' }, ls: { name: 'Lesotho', region: 'AF' },
  lr: { name: 'Liberia', region: 'AF' }, ly: { name: 'Libya', region: 'AF' },
  mg: { name: 'Madagascar', region: 'AF' }, mw: { name: 'Malawi', region: 'AF' },
  ml: { name: 'Mali', region: 'AF' }, mr: { name: 'Mauritania', region: 'AF' },
  mu: { name: 'Mauritius', region: 'AF' }, ma: { name: 'Morocco', region: 'AF' },
  mz: { name: 'Mozambique', region: 'AF' }, na: { name: 'Namibia', region: 'AF' },
  ne: { name: 'Niger', region: 'AF' }, ng: { name: 'Nigeria', region: 'AF' },
  rw: { name: 'Rwanda', region: 'AF' }, sn: { name: 'Senegal', region: 'AF' },
  sc: { name: 'Seychelles', region: 'AF' }, sl: { name: 'Sierra Leone', region: 'AF' },
  so: { name: 'Somalia', region: 'AF' }, za: { name: 'South Africa', region: 'AF' },
  ss: { name: 'South Sudan', region: 'AF' }, sd: { name: 'Sudan', region: 'AF' },
  sz: { name: 'Eswatini', region: 'AF' }, tz: { name: 'Tanzania', region: 'AF' },
  tg: { name: 'Togo', region: 'AF' }, tn: { name: 'Tunisia', region: 'AF' },
  ug: { name: 'Uganda', region: 'AF' }, zm: { name: 'Zambia', region: 'AF' },
  zw: { name: 'Zimbabwe', region: 'AF' },
  au: { name: 'Australia', region: 'OC' }, nz: { name: 'New Zealand', region: 'OC' },
  pg: { name: 'Papua New Guinea', region: 'OC' }, fj: { name: 'Fiji', region: 'OC' },
  sb: { name: 'Solomon Islands', region: 'OC' }, vu: { name: 'Vanuatu', region: 'OC' },
  ws: { name: 'Samoa', region: 'OC' }, to: { name: 'Tonga', region: 'OC' },
};

export const COUNTRY_NAMES: Record<string, { name: string; region: NewsRegion }> = Object.fromEntries(
  Object.entries(COUNTRIES).map(([iso, c]) => [iso, { name: c.name, region: c.region }]),
);

export const regionOfCountry = (iso: string | null): NewsRegion | null =>
  iso ? COUNTRIES[iso]?.region ?? null : null;

type Matcher = { re: RegExp; iso: string; len: number };
const MATCHERS: Matcher[] = [];
for (const [iso, c] of Object.entries(COUNTRIES)) {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const name of [c.name, ...(c.aliases ?? [])]) {
    if ((c.acronyms ?? []).includes(name)) continue;
    MATCHERS.push({ re: new RegExp(`(?<![\\w])${esc(name)}(?![\\w])`, 'i'), iso, len: name.length });
  }
  for (const a of c.acronyms ?? []) {
    MATCHERS.push({ re: new RegExp(`(?<![\\w.])${esc(a)}(?![\\w])`), iso, len: a.length });
  }
}

export function detectCountry(title: string): string | null {
  let best: { iso: string; idx: number; len: number } | null = null;
  for (const m of MATCHERS) {
    const hit = m.re.exec(title);
    if (!hit) continue;
    if (!best || hit.index < best.idx || (hit.index === best.idx && m.len > best.len)) {
      best = { iso: m.iso, idx: hit.index, len: m.len };
    }
  }
  return best?.iso ?? null;
}

export interface FeedSpec {
  name: string;
  category: NewsCategory;
  url: string;
  region?: NewsRegion | null;
  sub?: string | null;
}

export interface NewsItem {
  title: string;
  link: string;
  ts: string | null;
  source: string;
  region: NewsRegion | null;
  country: string | null;
  image: string | null;
}

export const DEFAULT_FEEDS: FeedSpec[] = [
  { name: 'BBC World', category: 'global', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', region: null },
  { name: 'NPR', category: 'global', url: 'https://feeds.npr.org/1001/rss.xml', region: 'NA', sub: 'us' },
  { name: 'CBC', category: 'global', url: 'https://www.cbc.ca/webfeed/rss/rss-topstories', region: 'NA', sub: 'ca' },
  { name: 'BBC US & Canada', category: 'global', url: 'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml', region: 'NA' },
  { name: 'BBC Latin America', category: 'global', url: 'https://feeds.bbci.co.uk/news/world/latin_america/rss.xml', region: 'SA' },
  { name: 'BBC Europe', category: 'global', url: 'https://feeds.bbci.co.uk/news/world/europe/rss.xml', region: 'EU' },
  { name: 'DW', category: 'global', url: 'https://rss.dw.com/rdf/rss-en-eu', region: 'EU' },
  { name: 'The Moscow Times', category: 'global', url: 'https://www.themoscowtimes.com/rss/news', region: 'AS', sub: 'ru' },
  { name: 'SCMP China', category: 'global', url: 'https://www.scmp.com/rss/4/feed', region: 'AS', sub: 'cn' },
  { name: 'The Japan Times', category: 'global', url: 'https://www.japantimes.co.jp/feed/', region: 'AS', sub: 'jp' },
  { name: 'BBC Asia', category: 'global', url: 'https://feeds.bbci.co.uk/news/world/asia/rss.xml', region: 'AS' },
  { name: 'BBC Middle East', category: 'global', url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml', region: 'AS' },
  { name: 'BBC Africa', category: 'global', url: 'https://feeds.bbci.co.uk/news/world/africa/rss.xml', region: 'AF' },
  { name: 'BBC Australia', category: 'global', url: 'https://feeds.bbci.co.uk/news/world/australia/rss.xml', region: 'OC' },
  { name: 'The Guardian', category: 'global', url: 'https://www.theguardian.com/world/rss', region: null },
  { name: 'Al Jazeera', category: 'global', url: 'https://www.aljazeera.com/xml/rss/all.xml', region: null },
  { name: 'France 24', category: 'global', url: 'https://www.france24.com/en/rss', region: null },
  { name: 'CNA', category: 'global', url: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml', region: 'AS', sub: 'sg' },
  { name: 'The National', category: 'global', url: 'https://www.thenationalnews.com/arc/outboundfeeds/rss/?outputType=xml', region: 'AS', sub: 'ae' },
  { name: 'ABC News AU', category: 'global', url: 'https://www.abc.net.au/news/feed/51120/rss.xml', region: 'OC', sub: 'au' },
  { name: 'RNZ Pacific', category: 'global', url: 'https://www.rnz.co.nz/rss/pacific.xml', region: 'OC' },
  { name: 'MercoPress', category: 'global', url: 'https://en.mercopress.com/rss/', region: 'SA' },
  { name: 'Punch Nigeria', category: 'global', url: 'https://punchng.com/feed/', region: 'AF', sub: 'ng' },
  { name: 'Ars Technica', category: 'tech', url: 'https://feeds.arstechnica.com/arstechnica/index' },
  { name: 'Hacker News', category: 'tech', url: 'https://news.ycombinator.com/rss' },
  { name: 'The Verge AI', category: 'ai', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
];

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“',
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

function safeChar(code: number): string {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

function unwrapCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function cleanText(s: string): string {
  return decodeEntities(unwrapCdata(s).replace(/<[^>]*>/g, ' '))
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function firstTag(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
  return m ? m[1]! : null;
}

function findLink(block: string): string | null {
  const plain = firstTag(block, 'link');
  if (plain && plain.trim()) {
    const t = cleanText(plain);
    if (t) return t;
  }
  const links = [...block.matchAll(/<link\b([^>]*?)\/?>(?![\s\S]*?<\/link>)/gi)].map((m) => m[1]!)
    .concat([...block.matchAll(/<link\b([^>]*?)>/gi)].map((m) => m[1]!));
  let fallback: string | null = null;
  for (const attrs of links) {
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (!href) continue;
    const rel = /rel\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (!rel || rel === 'alternate') return decodeEntities(href);
    fallback = fallback ?? decodeEntities(href);
  }
  return fallback;
}

function cleanImageUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const url = decodeEntities(String(raw)).trim();
  if (!/^https:\/\//i.test(url)) return null;
  if (/[\s"'<>]/.test(url)) return null;
  return url.length <= 500 ? url : null;
}

export function findImage(block: string): string | null {
  const thumb = /<media:thumbnail\b[^>]*\burl\s*=\s*["']([^"']+)["']/i.exec(block)?.[1];
  const fromThumb = cleanImageUrl(thumb);
  if (fromThumb) return fromThumb;

  for (const m of block.matchAll(/<(?:media:content|enclosure)\b([^>]*)>/gi)) {
    const attrs = m[1]!;
    const url = /\burl\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? '';
    const medium = /\bmedium\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? '';
    const looksImage = /^image\//i.test(type) || /^image$/i.test(medium) ||
      /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i.test(url ?? '');
    if (!looksImage) continue;
    const clean = cleanImageUrl(url);
    if (clean) return clean;
  }

  const html = decodeEntities(unwrapCdata(block));
  for (const m of html.matchAll(/<img\b([^>]*?)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>/gi)) {
    const attrs = (m[1] ?? '') + (m[3] ?? '');
    const src = m[2] ?? '';
    if (/pixel|tracking|tracker|beacon|spacer|blank\.|1x1/i.test(src)) continue;
    if (/\b(?:width|height)\s*=\s*["']?1["'\s>]/i.test(attrs)) continue;
    const clean = cleanImageUrl(src);
    if (clean) return clean;
  }
  return null;
}

function findDate(block: string): string | null {
  for (const tag of ['pubDate', 'dc:date', 'published', 'updated']) {
    const raw = firstTag(block, tag);
    if (raw) {
      const t = Date.parse(unwrapCdata(raw).trim());
      if (!Number.isNaN(t)) return new Date(t).toISOString();
    }
  }
  return null;
}

export function parseFeed(xml: string, source: string, cap = 30, spec?: Pick<FeedSpec, 'region' | 'sub'>): NewsItem[] {
  const doc = String(xml ?? '');
  const blocks = [
    ...doc.matchAll(/<item\b[\s\S]*?<\/item>/gi),
    ...doc.matchAll(/<entry\b[\s\S]*?<\/entry>/gi),
  ].map((m) => m[0]);

  const items: NewsItem[] = [];
  for (const block of blocks) {
    if (items.length >= cap) break;
    const title = cleanText(firstTag(block, 'title') ?? '');
    const link = findLink(block)?.trim() ?? '';
    if (!title || !/^https?:\/\//i.test(link)) continue;
    const country = detectCountry(title) ?? spec?.sub ?? null;
    items.push({
      title, link: link.slice(0, 500), ts: findDate(block), source,
      country, region: regionOfCountry(country) ?? spec?.region ?? null,
      image: findImage(block),
    });
  }
  return items;
}

export function normalizeFeeds(raw: unknown): FeedSpec[] {
  if (!Array.isArray(raw)) return DEFAULT_FEEDS;
  const out: FeedSpec[] = [];
  for (const f of raw) {
    const name = String((f as any)?.name ?? '').trim().slice(0, 60);
    const category = String((f as any)?.category ?? '') as NewsCategory;
    const url = String((f as any)?.url ?? '').trim();
    if (!name || !/^https?:\/\//i.test(url)) continue;
    if (!['global', 'national', 'tech', 'ai'].includes(category)) continue;
    const regionRaw = String((f as any)?.region ?? '').toUpperCase();
    const region = (REGIONS as string[]).includes(regionRaw) ? (regionRaw as NewsRegion) : null;
    const subRaw = String((f as any)?.sub ?? '').toLowerCase();
    const sub = region && subRaw in COUNTRIES ? subRaw : null;
    out.push({ name, category, url, region, sub });
  }
  return out.length ? out : DEFAULT_FEEDS;
}

export interface NewsCache {
  fetchedAt: string | null;
  categories: Record<NewsCategory, NewsItem[]>;
  errors: { feed: string; error: string }[];
}

export const emptyCache = (): NewsCache => ({
  fetchedAt: null,
  categories: { global: [], national: [], tech: [], ai: [] },
  errors: [],
});

const PER_FEED_CAP = 12;
const PER_REGION_CAP = 20;
const CATEGORY_CAP: Record<NewsCategory, number> = { global: Infinity, national: 25, tech: 25, ai: 25 };

export async function refreshNews(
  feeds: FeedSpec[],
  fetchText: (url: string) => Promise<string> = defaultFetch,
): Promise<NewsCache> {
  const cache = emptyCache();
  await Promise.all(feeds.map(async (feed) => {
    try {
      const items = parseFeed(await fetchText(feed.url), feed.name, PER_FEED_CAP, feed);
      const seen: Record<string, number> = {};
      for (const it of items) if (it.image) seen[it.image] = (seen[it.image] ?? 0) + 1;
      for (const it of items) {
        if (it.image && seen[it.image]! >= 3 && seen[it.image]! >= items.length / 2) it.image = null;
      }
      cache.categories[feed.category].push(...items);
    } catch (e: any) {
      cache.errors.push({ feed: feed.name, error: String(e?.message ?? e).slice(0, 200) });
    }
  }));
  for (const cat of Object.keys(cache.categories) as NewsCategory[]) {
    cache.categories[cat].sort((a, b) => String(b.ts ?? '').localeCompare(String(a.ts ?? '')));
    if (cat === 'global') {
      const kept: NewsItem[] = [];
      const perRegion: Record<string, number> = {};
      const seenTitle = new Set<string>();
      for (const it of cache.categories[cat]) {
        const key = it.title.toLowerCase();
        if (seenTitle.has(key)) continue;
        seenTitle.add(key);
        const bucket = it.region ?? 'world';
        if ((perRegion[bucket] = (perRegion[bucket] ?? 0) + 1) <= PER_REGION_CAP) kept.push(it);
      }
      cache.categories[cat] = kept;
    } else {
      cache.categories[cat] = cache.categories[cat].slice(0, CATEGORY_CAP[cat]);
    }
  }
  cache.fetchedAt = new Date().toISOString();
  return cache;
}

export function cachedImageUrls(cache: NewsCache): Set<string> {
  const out = new Set<string>();
  for (const items of Object.values(cache.categories))
    for (const it of items) if (it.image) out.add(it.image);
  return out;
}

async function defaultFetch(url: string): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 aeryx-rss/0.1',
      accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
