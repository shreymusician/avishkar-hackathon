// Farmer support: mandi prices and agricultural news, fetched here so browsers never call third parties and the
// results can be shared and cached. Government schemes have no public API (myScheme answers "Unauthorized"), so
// those are a reviewed list kept in the web app.
//
//   mandi prices : data.gov.in "Current daily price of various commodities from various markets (Mandi)", the
//                  AGMARKNET feed. Needs a free API key (DATA_GOV_API_KEY in .env: register at data.gov.in, then
//                  My Account > Generate API key). Without a key the page says how to get one.
//   news         : public RSS feeds: The Hindu and BusinessLine (English), Google News searches (English, Hindi,
//                  Kannada). No key. Google throttles quick repeats, so answers are cached for a while and the last
//                  good copy is kept when a source fails.

const MANDI_URL = 'https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070';
const FETCH_TIMEOUT_MS = 12000;
const MANDI_TTL_MS = 30 * 60 * 1000; // prices are posted once a day; this is plenty fresh
const NEWS_TTL_MS = 20 * 60 * 1000;
const PAGE = 1000; // rows per data.gov.in request
const MAX_PAGES = 3;
const MAX_NEWS = 30;
const AGENT = 'Mozilla/5.0 (compatible; AgriVision/1.0)';

const google = (q, hl) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}-IN&gl=IN&ceid=IN:${hl}`;

export const NEWS_FEEDS = {
  en: [
    { name: 'The Hindu', url: 'https://www.thehindu.com/sci-tech/agriculture/feeder/default.rss' },
    { name: 'BusinessLine', url: 'https://www.thehindubusinessline.com/economy/agri-business/feeder/default.rss' },
    { name: 'Google News', url: google('agriculture farmers karnataka', 'en'), publisherInTitle: true },
  ],
  hi: [{ name: 'Google News', url: google('कृषि किसान', 'hi'), publisherInTitle: true }],
  // Google News has no Kannada results over RSS, and the Kannada publishers have no farming-only feed, so the
  // general-news feeds are used and only stories that mention farming words are kept.
  kn: [
    { name: 'OneIndia ಕನ್ನಡ', url: 'https://kannada.oneindia.com/rss/kannada-fb.xml', keywords: KANNADA_FARM_WORDS() },
    { name: 'Asianet ಸುವರ್ಣ', url: 'https://kannada.asianetnews.com/rss', keywords: KANNADA_FARM_WORDS() },
  ],
};

/** Words that mark a Kannada story as being about farming: farming, farmer, crop, support price, major crops, drought, monsoon, irrigation... */
function KANNADA_FARM_WORDS() {
  return ['ಕೃಷಿ', 'ರೈತ', 'ಬೆಳೆ', 'ಬೆಂಬಲ ಬೆಲೆ', 'ಅಡಿಕೆ', 'ರಾಗಿ', 'ಭತ್ತ', 'ಕಾಫಿ', 'ತೋಟಗಾರಿಕೆ', 'ಬರಗಾಲ', 'ಮುಂಗಾರು', 'ಹಿಂಗಾರು', 'ನೀರಾವರಿ', 'ರಸಗೊಬ್ಬರ', 'ಕಬ್ಬು', 'ಈರುಳ್ಳಿ', 'ಮೆಕ್ಕೆಜೋಳ', 'ಹೈನುಗಾರಿಕೆ'];
}

/** Keeps the items whose headline mentions any of `words` (when a feed has no farming-only section). Headline only: the body text uses these words in ordinary sentences ("grew up"). */
export function onlyAbout(items, words) {
  if (!words?.length) return items;
  // A word counts only where it starts a word (endings are fine: ರೈತರು): "ರಾಗಿ" (ragi) must not match the end of "ನಿರ್ದೇಶಕರಾಗಿ" (as director).
  const starts = new RegExp(`(?<![\\p{L}\\p{M}])(?:${words.join('|')})`, 'u');
  return items.filter((i) => starts.test(i.title));
}

// ---- RSS ----------------------------------------------------------------------------------------

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Decodes the XML/HTML entities that show up in feeds, once. */
export function decodeEntities(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return NAMED[e.toLowerCase()] ?? whole;
  });
}

/** Feed text to plain text: unwraps CDATA, drops tags (they may arrive entity-encoded), collapses spaces. */
export function plainText(raw) {
  let text = String(raw ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  text = decodeEntities(text); // encoded markup becomes real markup here
  text = text.replace(/<[^>]*>/g, ' ');
  text = decodeEntities(text);
  return text.replace(/\s+/g, ' ').trim();
}

function inner(block, name) {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? m[1] : '';
}

const safeUrl = (u) => {
  const s = decodeEntities(String(u).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim();
  return /^https?:\/\//i.test(s) ? s : '';
};

/**
 * Items of an RSS 2.0 feed: { title, link, date (ISO or null), summary, source }.
 * `publisherInTitle` is for Google News, which writes "Headline - Publisher" and names the publisher in <source>.
 */
export function parseRss(xml, { defaultSource = '', publisherInTitle = false } = {}) {
  const items = [];
  for (const block of String(xml).match(/<item[\s>][\s\S]*?<\/item>/gi) ?? []) {
    let title = plainText(inner(block, 'title'));
    const link = safeUrl(inner(block, 'link') || (/<link>([^<]+)/i.exec(block)?.[1] ?? ''));
    if (!title || !link) continue;
    let source = plainText(inner(block, 'source')) || defaultSource;
    if (publisherInTitle) {
      const cut = title.lastIndexOf(' - ');
      if (cut > 10) {
        if (!source) source = title.slice(cut + 3);
        title = title.slice(0, cut);
      }
    }
    let summary = plainText(inner(block, 'description'));
    if (summary.startsWith(title) || summary.length < 20) summary = ''; // Google repeats the headline
    if (summary.length > 220) summary = `${summary.slice(0, 217).trimEnd()}…`;
    const when = Date.parse(inner(block, 'pubDate') || inner(block, 'dc:date'));
    items.push({ title, link, date: Number.isFinite(when) ? new Date(when).toISOString() : null, summary, source });
  }
  return items;
}

/** Merges feeds: newest first, the same headline once, capped. */
export function mergeNews(lists, limit = MAX_NEWS) {
  const seen = new Set();
  return lists
    .flat()
    .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))
    .filter((item) => {
      const key = item.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 80);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

// ---- mandi prices -------------------------------------------------------------------------------

const price = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** data.gov.in gives dd/mm/yyyy; this gives yyyy-mm-dd, or null. */
const isoDate = (v) => {
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(String(v ?? '').trim());
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};

/** Pure: data.gov.in rows to the compact shape the page uses. Prices are rupees per quintal (100 kg). */
export function shapeMandi(rows) {
  return rows
    .map((r) => ({
      market: String(r.market ?? '').trim(),
      district: String(r.district ?? '').trim(),
      commodity: String(r.commodity ?? '').trim(),
      variety: String(r.variety ?? '').trim(),
      date: isoDate(r.arrival_date),
      min: price(r.min_price),
      max: price(r.max_price),
      modal: price(r.modal_price),
    }))
    .filter((r) => r.market && r.commodity && r.modal != null);
}

// ---- the service --------------------------------------------------------------------------------

export function createSupport({ fetchImpl = fetch, now = Date.now, apiKey = '', log = console } = {}) {
  const cache = new Map(); // key -> { at, value }
  const inflight = new Map();

  async function getText(url, headers = {}) {
    const res = await fetchImpl(url, { headers: { 'user-agent': AGENT, ...headers }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
    if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
    return res.text();
  }

  /** Fresh within `ttl`; otherwise loaded once for all callers; if loading fails the last good copy is served. */
  async function cached(key, ttl, load) {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttl) return hit.value;
    if (inflight.has(key)) return inflight.get(key);
    const pending = load()
      .then((value) => {
        cache.set(key, { at: now(), value });
        return value;
      })
      .catch((err) => {
        if (hit) {
          log.warn?.(`[support] ${key}: ${err.message}; serving the last good copy`);
          return hit.value;
        }
        throw err;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
    return pending;
  }

  async function mandiPage(state, offset, keyName) {
    const url = new URL(MANDI_URL);
    url.searchParams.set('api-key', apiKey);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', String(PAGE));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set(`filters[${keyName}]`, state);
    const body = JSON.parse(await getText(url));
    if (body.error) throw new Error(`data.gov.in: ${String(body.error).slice(0, 80)}`);
    return { rows: Array.isArray(body.records) ? body.records : [], total: Number(body.total) || 0 };
  }

  /** Today's mandi prices for one state. Resolves { configured, records, latest }. */
  function mandi(state) {
    if (!apiKey) return Promise.resolve({ configured: false, records: [], latest: null });
    return cached(`mandi:${state.toLowerCase()}`, MANDI_TTL_MS, async () => {
      // The state filter is `state.keyword` on this dataset; plain `state` is the fallback if it matches nothing.
      for (const keyName of ['state.keyword', 'state']) {
        let rows = [];
        let total = 0;
        for (let page = 0; page < MAX_PAGES; page += 1) {
          const got = await mandiPage(state, page * PAGE, keyName);
          rows = rows.concat(got.rows);
          total = got.total;
          if (rows.length >= total || got.rows.length < PAGE) break;
        }
        if (rows.length > 0) {
          const records = shapeMandi(rows);
          const latest = records.map((r) => r.date).filter(Boolean).sort().at(-1) ?? null;
          return { configured: true, records, latest };
        }
      }
      return { configured: true, records: [], latest: null };
    });
  }

  /** Agricultural news in `lang` (en, hi or kn); English when that language has nothing. */
  async function news(lang) {
    const want = NEWS_FEEDS[lang] ? lang : 'en';
    const load = (code) =>
      cached(`news:${code}`, NEWS_TTL_MS, async () => {
        const results = await Promise.allSettled(
          NEWS_FEEDS[code].map(async (feed) =>
            onlyAbout(parseRss(await getText(feed.url), { defaultSource: feed.name, publisherInTitle: feed.publisherInTitle }), feed.keywords),
          ),
        );
        const lists = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
        results.filter((r) => r.status === 'rejected').forEach((r) => log.warn?.(`[support] news ${code}: ${r.reason.message}`));
        if (lists.length === 0) throw new Error('no news source answered');
        return mergeNews(lists);
      });
    let items = [];
    try {
      items = await load(want);
    } catch (err) {
      if (want === 'en') throw err;
    }
    if (items.length === 0 && want !== 'en') return { lang: 'en', fallback: true, items: await load('en') };
    return { lang: want, fallback: false, items };
  }

  return { mandi, news, clear: () => cache.clear() };
}
