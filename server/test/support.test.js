import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSupport, decodeEntities, mergeNews, onlyAbout, parseRss, plainText, shapeMandi } from '../src/support.js';

const quiet = { warn() {}, info() {} };

const rss = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${items.join('')}</channel></rss>`;
const item = (title, link, date, desc = '', extra = '') =>
  `<item><title>${title}</title><link>${link}</link><pubDate>${date}</pubDate><description>${desc}</description>${extra}</item>`;

test('entities and markup in feed text become plain text', () => {
  assert.equal(decodeEntities('Tom &amp; Jerry &#8217;s &#x41; &quot;ok&quot;'), 'Tom & Jerry ’s A "ok"');
  assert.equal(plainText('<![CDATA[<p>Rain &amp; <b>hail</b> hit</p>]]>'), 'Rain & hail hit');
  assert.equal(plainText('&lt;a href=&quot;x&quot;&gt;Wheat&lt;/a&gt;   prices'), 'Wheat prices');
  assert.equal(plainText(undefined), '');
});

test('an RSS feed becomes items, newest data kept, junk skipped', () => {
  const xml = rss([
    item('Ragi sowing begins', 'https://example.com/a', 'Wed, 25 Nov 2026 06:00:00 GMT', '<![CDATA[<p>Farmers in Hassan start sowing ragi after the first good rain of the season.</p>]]>'),
    item('No link here', '', 'Wed, 25 Nov 2026 06:00:00 GMT'),
    item('Unsafe link', 'javascript:alert(1)', 'Wed, 25 Nov 2026 06:00:00 GMT'),
    item('Bad date', 'https://example.com/b', 'not a date'),
  ]);
  const items = parseRss(xml, { defaultSource: 'The Hindu' });
  assert.deepEqual(items.map((i) => i.title), ['Ragi sowing begins', 'Bad date']);
  assert.equal(items[0].date, '2026-11-25T06:00:00.000Z');
  assert.equal(items[0].source, 'The Hindu');
  assert.match(items[0].summary, /^Farmers in Hassan/);
  assert.equal(items[1].date, null);
});

test('Google News headlines are split into headline and publisher, and the repeated headline is dropped', () => {
  const xml = rss([
    item('Drought relief for coffee growers - Deccan Herald', 'https://news.google.com/x', 'Wed, 25 Nov 2026 05:00:00 GMT',
      '&lt;a href="x"&gt;Drought relief for coffee growers&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font&gt;Deccan Herald&lt;/font&gt;',
      '<source url="https://www.deccanherald.com">Deccan Herald</source>'),
  ]);
  const [one] = parseRss(xml, { defaultSource: 'Google News', publisherInTitle: true });
  assert.equal(one.title, 'Drought relief for coffee growers');
  assert.equal(one.source, 'Deccan Herald');
  assert.equal(one.summary, '');
});

test('merged news is newest first, the same headline appears once, and the list is capped', () => {
  const a = { title: 'Rain  hits Mandya!', link: 'https://a', date: '2026-11-25T01:00:00Z', summary: '', source: 'A' };
  const b = { title: 'rain hits mandya', link: 'https://b', date: '2026-11-25T03:00:00Z', summary: '', source: 'B' };
  const c = { title: 'Paddy prices up', link: 'https://c', date: '2026-11-25T02:00:00Z', summary: '', source: 'C' };
  const merged = mergeNews([[a, c], [b]]);
  assert.deepEqual(merged.map((i) => i.source), ['B', 'C']);
  assert.equal(mergeNews([[a, c], [b]], 1).length, 1);
});

test('general-news feeds are narrowed to farming stories', () => {
  const mk = (title, summary = '') => ({ title, link: 'https://x', date: null, summary, source: 'S' });
  const kept = onlyAbout([mk('ರೈತರಿಗೆ ಬೆಂಬಲ ಬೆಲೆ ಘೋಷಣೆ'), mk('ಕ್ರಿಕೆಟ್ ಪಂದ್ಯ ಇಂದು', 'ರೈತ ಕುಟುಂಬದಿಂದ ಬಂದ ಆಟಗಾರ'), mk('ಮುಂಗಾರು ಮಳೆ ಆರಂಭ')], ['ರೈತ', 'ಮುಂಗಾರು']);
  assert.deepEqual(kept.map((i) => i.title), ['ರೈತರಿಗೆ ಬೆಂಬಲ ಬೆಲೆ ಘೋಷಣೆ', 'ಮುಂಗಾರು ಮಳೆ ಆರಂಭ']); // a farmer only in the body text does not count
  assert.equal(onlyAbout([mk('a')], undefined).length, 1);
  // the word must start a word: "ರಾಗಿ" (ragi) ends "ನಿರ್ದೇಶಕರಾಗಿ" (as director), which is not about ragi
  assert.deepEqual(onlyAbout([mk('ಸಚಿನ್ ನಿರ್ದೇಶಕರಾಗಿ ನೇಮಕ'), mk('ರಾಗಿ ಖರೀದಿ ಆರಂಭ'), mk('ರಾಗಿಯ ಬೆಲೆ ಏರಿಕೆ')], ['ರಾಗಿ']).map((i) => i.title), ['ರಾಗಿ ಖರೀದಿ ಆರಂಭ', 'ರಾಗಿಯ ಬೆಲೆ ಏರಿಕೆ']);
});

test('mandi rows are shaped: prices are numbers, dates ISO, rows without a modal price dropped', () => {
  const rows = shapeMandi([
    { market: 'Chikmagalur', district: 'Chikmagalur', commodity: 'Arecanut', variety: 'Other', arrival_date: '25/11/2026', min_price: '45000', max_price: '52,000', modal_price: '49000' },
    { market: 'Hassan', district: 'Hassan', commodity: 'Ragi', variety: 'Ragi', arrival_date: '25/11/2026', min_price: '', max_price: '', modal_price: '' },
    { market: '', district: 'X', commodity: 'Y', modal_price: '1' },
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { market: 'Chikmagalur', district: 'Chikmagalur', commodity: 'Arecanut', variety: 'Other', date: '2026-11-25', min: 45000, max: 52000, modal: 49000 });
});

const json = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
const textOf = (xml) => ({ ok: true, status: 200, text: async () => xml });

test('without an API key mandi prices say so and make no request', async () => {
  let calls = 0;
  const s = createSupport({ fetchImpl: async () => (calls += 1, json({})), apiKey: '', log: quiet });
  assert.deepEqual(await s.mandi('Karnataka'), { configured: false, records: [], latest: null });
  assert.equal(calls, 0);
});

test('mandi prices: key and state go in the request, pages are followed, the answer is cached', async () => {
  const seen = [];
  const rowsFor = (n, offset) =>
    Array.from({ length: n }, (_, i) => ({ market: `M${offset + i}`, district: 'Hassan', commodity: 'Ragi', variety: 'Ragi', arrival_date: '24/11/2026', min_price: '3000', max_price: '3600', modal_price: '3300' }));
  const impl = async (url) => {
    const u = new URL(url);
    seen.push(u);
    const offset = Number(u.searchParams.get('offset'));
    return json({ total: 1200, records: offset === 0 ? rowsFor(1000, 0) : rowsFor(200, 1000) });
  };
  const s = createSupport({ fetchImpl: impl, apiKey: 'KEY123', log: quiet });
  const first = await s.mandi('Karnataka');
  assert.equal(first.records.length, 1200);
  assert.equal(first.latest, '2026-11-24');
  assert.equal(seen.length, 2);
  assert.equal(seen[0].searchParams.get('api-key'), 'KEY123');
  assert.equal(seen[0].searchParams.get('filters[state.keyword]'), 'Karnataka');
  await s.mandi('karnataka'); // same state, any case: served from the cache
  assert.equal(seen.length, 2);
});

test('mandi prices fall back to the plain state filter when state.keyword matches nothing', async () => {
  const keys = [];
  const impl = async (url) => {
    const u = new URL(url);
    const key = [...u.searchParams.keys()].find((k) => k.startsWith('filters['));
    keys.push(key);
    return json(key === 'filters[state]' ? { total: 1, records: [{ market: 'Hassan', district: 'Hassan', commodity: 'Ragi', modal_price: '3300', arrival_date: '24/11/2026' }] } : { total: 0, records: [] });
  };
  const s = createSupport({ fetchImpl: impl, apiKey: 'K', log: quiet });
  const r = await s.mandi('Karnataka');
  assert.equal(r.records.length, 1);
  assert.deepEqual(keys, ['filters[state.keyword]', 'filters[state]']);
});

test('mandi prices: an API error rejects, and an older copy is served when a refresh fails', async () => {
  let t = 0;
  let fail = false;
  const impl = async () =>
    fail ? { ok: false, status: 503, text: async () => '' } : json({ total: 1, records: [{ market: 'Hassan', district: 'Hassan', commodity: 'Ragi', modal_price: '3300', arrival_date: '24/11/2026' }] });
  const s = createSupport({ fetchImpl: impl, apiKey: 'K', now: () => t, log: quiet });
  await s.mandi('Karnataka');
  t += 31 * 60 * 1000; // past the cache time
  fail = true;
  const stale = await s.mandi('Karnataka');
  assert.equal(stale.records.length, 1);
  s.clear();
  await assert.rejects(s.mandi('Karnataka'));
});

test('news: sources are merged, one failing source is tolerated, and a language with nothing falls back to English', async () => {
  const en = rss([item('Ragi support price raised', 'https://e/1', 'Wed, 25 Nov 2026 06:00:00 GMT', 'The state raised the ragi support price for this season.')]);
  const impl = async (url) => {
    if (url.includes('thehindubusinessline')) return { ok: false, status: 500, text: async () => '' };
    if (url.includes('hl=hi')) return textOf(rss([])); // Hindi feed answered but empty
    return textOf(en);
  };
  const s = createSupport({ fetchImpl: impl, log: quiet });
  const english = await s.news('en');
  assert.equal(english.fallback, false);
  assert.equal(english.items.length, 1); // the same story from The Hindu and Google appears once
  const hindi = await s.news('hi');
  assert.equal(hindi.fallback, true);
  assert.equal(hindi.lang, 'en');
  assert.equal(hindi.items.length, 1);
});

test('news: when every source fails the call rejects', async () => {
  const s = createSupport({ fetchImpl: async () => ({ ok: false, status: 500, text: async () => '' }), log: quiet });
  await assert.rejects(s.news('en'));
});
