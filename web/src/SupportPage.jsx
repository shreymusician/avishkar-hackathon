import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePrefs } from './prefs.jsx';
import { useAuth } from './auth.jsx';
import { useField } from './useField.js';
import { SCHEMES } from './schemes.js';

// State names as data.gov.in spells them (so "Chattisgarh" and "Uttrakhand" are not typos here).
const STATES = [
  'Andaman and Nicobar', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chattisgarh', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'NCT of Delhi', 'Nagaland', 'Odisha', 'Pondicherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttrakhand', 'West Bengal',
];

/** A place name boiled down to its consonants with repeats collapsed: "Chikkamagaluru" and "Chikmagalur" both give "chkmglr". */
const skeleton = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '').replace(/[aeiou]/g, '').replace(/(.)\1+/g, '$1');
const sameName = (a, b) => {
  const x = skeleton(a);
  const y = skeleton(b);
  return x.length >= 3 && y.length >= 3 && (x === y || (Math.min(x.length, y.length) >= 5 && (x.startsWith(y) || y.startsWith(x))));
};

const rupees = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

/** GET a JSON path with the access key; keeps the last answer while a new one loads. */
function useApi(path, accessKey) {
  const [state, setState] = useState({ path: null, status: 'loading', data: null, at: 0 });
  const abort = useRef(null);
  const load = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setState((s) => ({ ...s, path, status: s.path === path && s.data ? 'refreshing' : 'loading', data: s.path === path ? s.data : null }));
    try {
      const res = await fetch(path, { headers: { 'x-access-key': accessKey }, signal: controller.signal });
      if (!res.ok) throw new Error(String(res.status));
      setState({ path, status: 'ready', data: await res.json(), at: Date.now() });
    } catch {
      if (controller.signal.aborted) return;
      setState((s) => ({ ...s, path, status: 'error', data: s.path === path ? s.data : null }));
    }
  }, [path, accessKey]);
  useEffect(() => {
    load();
    return () => abort.current?.abort();
  }, [load]);
  return { ...state, data: state.path === path ? state.data : null, reload: load };
}

/** Farmer support: mandi prices, government schemes and agricultural news, one tab each. */
export default function SupportPage({ accessKey }) {
  const { t } = usePrefs();
  const [tab, setTab] = useState(() => {
    try {
      return sessionStorage.getItem('agrivision-support-tab') || 'mandi';
    } catch {
      return 'mandi';
    }
  });
  const pick = (id) => {
    setTab(id);
    try {
      sessionStorage.setItem('agrivision-support-tab', id);
    } catch {
      /* not remembered */
    }
  };
  const tabs = [
    ['mandi', 'support.tab.mandi'],
    ['schemes', 'support.tab.schemes'],
    ['news', 'support.tab.news'],
  ];
  return (
    <>
      <div className="support-tabs seg seg-3" role="group" aria-label={t('support.title')}>
        {tabs.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => pick(id)}>
            {t(label)}
          </button>
        ))}
      </div>
      {tab === 'mandi' && <MandiPrices accessKey={accessKey} />}
      {tab === 'schemes' && <Schemes />}
      {tab === 'news' && <News accessKey={accessKey} />}
    </>
  );
}

// ---- mandi prices ---------------------------------------------------------------------------------

function MandiPrices({ accessKey }) {
  const { t, locale } = usePrefs();
  const { user } = useAuth();
  const field = useField(accessKey); // where this device is: the first guess for state and district
  const region = field.data?.region;

  const guessState = useMemo(
    () => STATES.find((s) => region?.state && sameName(s, region.state)) ?? STATES.find((s) => user?.state && sameName(s, user.state)) ?? 'Karnataka',
    [region, user],
  );
  const [pickedState, setPickedState] = useState(null);
  const [pickedDistrict, setPickedDistrict] = useState(null);
  const [mode, setMode] = useState('district');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(40);
  const state = pickedState ?? guessState;

  const api = useApi(`/api/support/mandi?state=${encodeURIComponent(state)}`, accessKey);
  const records = api.data?.records ?? [];

  const districts = useMemo(() => {
    const counts = new Map();
    for (const r of records) counts.set(r.district, (counts.get(r.district) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, n]) => ({ name, n }));
  }, [records]);

  const guessDistrict = useMemo(() => {
    if (districts.length === 0) return '';
    const byCity = region?.city && districts.find((d) => sameName(d.name, region.city));
    const byProfile = user?.district && districts.find((d) => sameName(d.name, user.district));
    return (byCity || byProfile || [...districts].sort((a, b) => b.n - a.n)[0]).name;
  }, [districts, region, user]);
  const district = pickedDistrict && districts.some((d) => d.name === pickedDistrict) ? pickedDistrict : guessDistrict;

  const needle = query.trim().toLowerCase();
  const matches = (r) => !needle || r.commodity.toLowerCase().includes(needle);
  const rows = useMemo(() => {
    if (mode === 'district') {
      return records.filter((r) => r.district === district && matches(r)).sort((a, b) => a.commodity.localeCompare(b.commodity) || a.market.localeCompare(b.market));
    }
    if (!needle) return [];
    return records.filter(matches).sort((a, b) => b.modal - a.modal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, mode, district, needle]);

  const topCrops = useMemo(() => {
    const counts = new Map();
    for (const r of records) counts.set(r.commodity, (counts.get(r.commodity) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name]) => name);
  }, [records]);

  const date = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' }) : '—');
  const stateSelect = (
    <label className="support-field">
      <span className="mono">{t('support.mandi.state').toUpperCase()}</span>
      <select
        value={state}
        onChange={(e) => {
          setPickedState(e.target.value);
          setPickedDistrict(null);
          setShown(40);
        }}
      >
        {STATES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </label>
  );

  if (api.data && api.data.configured === false) {
    return (
      <section className="card" aria-label={t('support.mandi.title')}>
        <h2 className="card-title">{t('support.mandi.title')}</h2>
        <div className="locate" role="status">
          <p className="locate-text">
            <strong>{t('support.mandi.nokey.title')}</strong>
          </p>
          <p className="locate-text">{t('support.mandi.nokey')}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="card" aria-label={t('support.mandi.title')}>
      <h2 className="card-title">
        {t('support.mandi.title')}
        {api.data?.latest && <span className="mono card-note">{t('support.mandi.asOf', { date: date(api.data.latest) }).toUpperCase()}</span>}
      </h2>

      {field.data?.place && <p className="support-where mono">{t('support.mandi.location', { place: field.data.place }).toUpperCase()}</p>}

      <div className="support-filters">
        {stateSelect}
        <label className="support-field">
          <span className="mono">{t('support.mandi.district').toUpperCase()}</span>
          <select
            value={district}
            disabled={mode !== 'district' || districts.length === 0}
            onChange={(e) => {
              setPickedDistrict(e.target.value);
              setShown(40);
            }}
          >
            {districts.map((d) => (
              <option key={d.name} value={d.name}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="seg support-mode" role="group" aria-label={t('support.mandi.title')}>
        <button type="button" aria-pressed={mode === 'district'} onClick={() => (setMode('district'), setShown(40))}>
          {t('support.mandi.mine')}
        </button>
        <button type="button" aria-pressed={mode === 'state'} onClick={() => (setMode('state'), setShown(40))}>
          {t('support.mandi.all')}
        </button>
      </div>

      <label className="support-field support-crop">
        <span className="mono">{t('support.mandi.crop').toUpperCase()}</span>
        <input
          type="search"
          value={query}
          placeholder={t('support.mandi.cropHint')}
          onChange={(e) => {
            setQuery(e.target.value);
            setShown(40);
          }}
        />
      </label>
      {!needle && topCrops.length > 0 && (
        <div className="chips" role="group" aria-label={t('support.mandi.crop')}>
          {topCrops.map((crop) => (
            <button key={crop} type="button" className="chip" onClick={() => setQuery(crop)}>
              {crop}
            </button>
          ))}
        </div>
      )}

      {(api.status === 'loading' || (api.status === 'refreshing' && !api.data)) && <p className="muted mono">{t('support.mandi.loading').toUpperCase()}</p>}
      {api.status === 'error' && !api.data && (
        <div className="locate" role="alert">
          <p className="locate-text">{t('support.mandi.err')}</p>
          <button type="button" className="plain" onClick={api.reload}>
            {t('field.retry')}
          </button>
        </div>
      )}

      {api.data && mode === 'state' && !needle && <p className="support-empty">{t('support.mandi.pickCrop', { state })}</p>}
      {api.data && mode === 'state' && needle && rows.length > 0 && <p className="sub-title mono">{t('support.mandi.top', { state, crop: query.trim() }).toUpperCase()}</p>}
      {api.data && rows.length === 0 && (mode === 'district' || needle) && <p className="support-empty">{needle ? t('support.mandi.noneCrop') : t('support.mandi.none')}</p>}

      <ul className="mandi-list">
        {rows.slice(0, shown).map((r, i) => (
          <li key={`${r.market}|${r.commodity}|${r.variety}|${i}`} className="mandi-row">
            <div className="mandi-what">
              <p className="mandi-crop">
                {r.commodity}
                {r.variety && r.variety.toLowerCase() !== r.commodity.toLowerCase() && r.variety.toLowerCase() !== 'other' && <span> · {r.variety}</span>}
              </p>
              <p className="mandi-market mono">
                {r.market}
                {mode === 'state' && ` · ${r.district}`} · {date(r.date)}
              </p>
            </div>
            <div className="mandi-price">
              <p className="mandi-modal">
                ₹{rupees(r.modal)}
                <span> / {t('support.mandi.quintal')}</span>
              </p>
              <p className="mono mandi-sub">{t('support.mandi.perKg', { n: (r.modal / 100).toFixed(1) })}</p>
              {r.min != null && r.max != null && <p className="mono mandi-sub">{t('support.mandi.range', { lo: rupees(r.min), hi: rupees(r.max) })}</p>}
            </div>
          </li>
        ))}
      </ul>
      {rows.length > shown && (
        <button type="button" className="ghost support-more" onClick={() => setShown((n) => n + 40)}>
          {t('support.mandi.more')}
        </button>
      )}
      {api.data && <p className="muted support-source">{t('support.mandi.source')}</p>}
    </section>
  );
}

// ---- government schemes ---------------------------------------------------------------------------

function Schemes() {
  const { t, lang } = usePrefs();
  const [level, setLevel] = useState('all');
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const list = SCHEMES.filter(
    (s) =>
      (level === 'all' || s.level === level) &&
      (!needle || `${s.name} ${s.summary[lang] ?? s.summary.en} ${s.summary.en}`.toLowerCase().includes(needle)),
  );
  const levels = [
    ['all', 'support.schemes.all'],
    ['central', 'support.schemes.central'],
    ['state', 'support.schemes.state'],
  ];
  return (
    <section className="card" aria-label={t('support.schemes.title')}>
      <h2 className="card-title">
        {t('support.schemes.title')}
        <span className="mono card-note">{t('support.schemes.count', { n: list.length }).toUpperCase()}</span>
      </h2>
      <div className="locate" role="note">
        <p className="locate-text">{t('support.schemes.notice')}</p>
      </div>
      <label className="support-field support-crop">
        <span className="mono">{t('support.schemes.search').toUpperCase()}</span>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="chips" role="group" aria-label={t('support.schemes.title')}>
        {levels.map(([id, label]) => (
          <button key={id} type="button" className="chip" aria-pressed={level === id} onClick={() => setLevel(id)}>
            {t(label)}
          </button>
        ))}
      </div>
      {list.length === 0 && <p className="support-empty">{t('support.schemes.none')}</p>}
      <ul className="scheme-list">
        {list.map((s) => (
          <li key={s.id} className="scheme" data-level={s.level}>
            <p className="scheme-level mono">{t(`support.schemes.level.${s.level}`).toUpperCase()}</p>
            <h3 className="scheme-name">{s.name}</h3>
            <p className="scheme-what">{s.summary[lang] ?? s.summary.en}</p>
            <p className="scheme-who">
              <strong>{t('support.schemes.who')}: </strong>
              {s.who[lang] ?? s.who.en}
            </p>
            <a className="scheme-link" href={s.url} target="_blank" rel="noopener noreferrer">
              {t(s.site === 'myscheme' ? 'support.schemes.openMy' : 'support.schemes.open')} ↗
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---- agricultural news ----------------------------------------------------------------------------

function News({ accessKey }) {
  const { t, lang, locale } = usePrefs();
  const api = useApi(`/api/support/news?lang=${lang}`, accessKey);
  const items = api.data?.items ?? [];
  const ago = (iso) => {
    if (!iso) return '';
    const minutes = Math.round((Date.parse(iso) - Date.now()) / 60000);
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
    if (Math.abs(minutes) < 60 * 36) return rtf.format(Math.round(minutes / 60), 'hour');
    return rtf.format(Math.round(minutes / 1440), 'day');
  };
  return (
    <section className="card" aria-label={t('support.news.title')}>
      <h2 className="card-title">
        {t('support.news.title')}
        {api.data?.updatedAt && (
          <span className="mono card-note">
            {t('support.news.updated', { time: new Date(api.data.updatedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) }).toUpperCase()}
          </span>
        )}
      </h2>
      {api.data?.fallback && (
        <div className="locate" role="status">
          <p className="locate-text">{t('support.news.fallback')}</p>
        </div>
      )}
      {(api.status === 'loading' || (api.status === 'refreshing' && !api.data)) && <p className="muted mono">{t('support.news.loading').toUpperCase()}</p>}
      {api.status === 'error' && !api.data && (
        <div className="locate" role="alert">
          <p className="locate-text">{t('support.news.err')}</p>
          <button type="button" className="plain" onClick={api.reload}>
            {t('field.retry')}
          </button>
        </div>
      )}
      {api.data && items.length === 0 && <p className="support-empty">{t('support.news.none')}</p>}
      <ul className="news-list">
        {items.map((n) => (
          <li key={n.link} className="news-item">
            <a href={n.link} target="_blank" rel="noopener noreferrer">
              <span className="news-title">{n.title}</span>
              {n.summary && <span className="news-summary">{n.summary}</span>}
              <span className="news-meta mono">
                {[n.source, ago(n.date)].filter(Boolean).join(' · ')}
              </span>
            </a>
          </li>
        ))}
      </ul>
      <div className="support-foot">
        <button type="button" className="ghost" onClick={api.reload} disabled={api.status === 'refreshing'}>
          {t('support.news.refresh')}
        </button>
        <p className="muted support-source">{t('support.news.source')}</p>
      </div>
    </section>
  );
}
