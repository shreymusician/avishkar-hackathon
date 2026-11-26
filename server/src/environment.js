// Field conditions for a position, fetched by the server so browsers never talk to third parties
// and the results can be shared and cached. All sources are free and need no key:
//   weather, soil and forecast : Open-Meteo        https://open-meteo.com  (CC BY 4.0)
//   air quality                : Open-Meteo Air Quality
//   place name                 : BigDataCloud reverse geocoding
//   position from an address   : ipwho.is (city accuracy at best)
// Coordinates are rounded to 3 decimals (about 100 m) before they leave the server.

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const AIR = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const GEOCODE = 'https://api.bigdatacloud.net/data/reverse-geocode-client';
const IP_LOOKUP = 'https://ipwho.is/';

const FETCH_TIMEOUT_MS = 8000;
export const ENVIRONMENT_TTL_MS = 10 * 60 * 1000; // weather models update hourly; this is plenty fresh
export const IP_TTL_MS = 60 * 60 * 1000;

const round3 = (n) => Math.round(n * 1000) / 1000;
const pct = (v) => (v == null ? null : Math.round(v * 100)); // m³/m³ -> % by volume

/** True for loopback, private (RFC 1918), link-local and unique-local addresses. */
export function isPrivateAddress(ip) {
  if (!ip) return true;
  const a = ip.replace(/^::ffff:/i, '');
  if (a === '::1' || a === '127.0.0.1' || a === 'localhost') return true;
  if (/^(10\.|127\.|192\.168\.|169\.254\.)/.test(a)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(a)) return true;
  return /^(fc|fd|fe80)/i.test(a);
}

/** Translation key for a WMO weather code (the dashboard's `wx.*` strings). */
export function weatherKey(code) {
  if (code === 0 || code === 1 || code === 2 || code === 3) return `wx.${code}`;
  if (code === 45 || code === 48) return 'wx.fog';
  if (code >= 51 && code <= 55) return 'wx.drizzle';
  if (code === 61) return 'wx.rainLight';
  if (code === 63) return 'wx.rain';
  if (code === 65) return 'wx.rainHeavy';
  if (code === 80 || code === 81 || code === 82) return 'wx.showers';
  if (code === 71 || code === 73 || code === 75) return 'wx.snow';
  if (code === 95 || code === 96 || code === 99) return 'wx.thunder';
  return 'wx.unknown';
}

/**
 * @param {{fetchImpl?: typeof fetch, now?: () => number, log?: {warn: Function}}} [options]
 */
export function createEnvironment({ fetchImpl = fetch, now = Date.now, log = console } = {}) {
  /** @type {Map<string, {at: number, value: any}>} */
  const environmentCache = new Map();
  /** @type {Map<string, {at: number, value: any}>} */
  const ipCache = new Map();
  /** @type {Map<string, Promise<any>>} */
  const inflight = new Map();

  async function getJson(url) {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
    return res.json();
  }

  /** Shared by concurrent callers and remembered for `ttl`. */
  async function cached(cache, key, ttl, load) {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttl) return hit.value;
    if (inflight.has(key)) return inflight.get(key);
    const pending = load()
      .then((value) => {
        cache.set(key, { at: now(), value });
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
    return pending;
  }

  /**
   * Where an address is, roughly. A private or loopback address (the laptop on its own network) says
   * nothing, so the lookup then uses this server's own public address: the network it sits on.
   */
  function locateByAddress(ip) {
    const target = isPrivateAddress(ip) ? '' : ip;
    return cached(ipCache, target || 'self', IP_TTL_MS, async () => {
      const data = await getJson(`${IP_LOOKUP}${target}`);
      if (!data.success) throw new Error('address lookup failed');
      return { lat: data.latitude, lon: data.longitude, accuracy: null };
    });
  }

  /** Village, district and state for where an address is, to prefill the signup form. Approximate: the person edits it. */
  async function placeByAddress(ip) {
    const { lat, lon } = await locateByAddress(ip);
    const la = round3(lat);
    const lo = round3(lon);
    return cached(ipCache, `place:${la},${lo}`, ENVIRONMENT_TTL_MS, async () => {
      const place = await getJson(`${GEOCODE}?latitude=${la}&longitude=${lo}&localityLanguage=en`);
      return { village: place.locality ?? '', district: place.city ?? '', state: place.principalSubdivision ?? '' };
    });
  }

  /** Everything the dashboard shows for one position. Air quality and place name are optional. */
  function forPosition({ lat, lon }) {
    const la = round3(lat);
    const lo = round3(lon);
    return cached(environmentCache, `${la},${lo}`, ENVIRONMENT_TTL_MS, async () => {
      const forecastUrl =
        `${FORECAST}?latitude=${la}&longitude=${lo}` +
        '&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code' +
        '&hourly=soil_moisture_0_to_1cm,soil_moisture_9_to_27cm,soil_temperature_0cm,precipitation,precipitation_probability,wind_speed_10m' +
        '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,et0_fao_evapotranspiration,uv_index_max,sunrise,sunset' +
        '&forecast_days=3&timezone=auto';

      const [forecast, air, place] = await Promise.all([
        getJson(forecastUrl),
        getJson(`${AIR}?latitude=${la}&longitude=${lo}&current=us_aqi,pm2_5`).catch(() => null),
        getJson(`${GEOCODE}?latitude=${la}&longitude=${lo}&localityLanguage=en`).catch(() => null),
      ]);
      return shape(forecast, air, place);
    });
  }

  return { locateByAddress, placeByAddress, forPosition, clear: () => (environmentCache.clear(), ipCache.clear()) };
}

/**
 * A position a phone reported ("lat,lon,accuracy-in-metres", from the x-phone-position header), or null when it is
 * missing or not a real coordinate. Rounded to 2 decimals (about 1 km): the weather model is no finer than that, and it
 * keeps the cache small and the stored position coarse.
 */
export function parsePhonePosition(raw) {
  if (typeof raw !== 'string') return null;
  const [la, lo, acc] = raw.split(',').map((v) => (v.trim() === '' ? NaN : Number(v)));
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  return {
    lat: Math.round(la * 100) / 100,
    lon: Math.round(lo * 100) / 100,
    accuracy: Number.isFinite(acc) && acc >= 0 ? Math.round(acc) : null,
  };
}

/** Pure: turns the three upstream answers into the dashboard's data. */
export function shape(forecast, air, place) {
  // Hourly series: find the hour the current reading belongs to, then look ahead from there.
  const h = forecast.hourly;
  const hour = forecast.current.time.slice(0, 13);
  let i = h.time.findIndex((t) => t.startsWith(hour));
  if (i < 0) i = 0;

  // First wet hour in the next 24 h (0 = this hour), or null.
  let rainInHours = null;
  for (let n = 0; n < 24 && i + n < h.time.length; n += 1) {
    if ((h.precipitation[i + n] ?? 0) >= 0.2 || (h.precipitation_probability[i + n] ?? 0) >= 60) {
      rainInHours = n;
      break;
    }
  }
  // Calm and dry for the next 3 hours: a decent window for spraying.
  const next3 = [0, 1, 2].map((n) => i + n).filter((n) => n < h.time.length);
  const sprayWindow =
    next3.length > 0 &&
    next3.every((n) => (h.wind_speed_10m[n] ?? 99) < 15 && (h.precipitation[n] ?? 1) === 0 && (h.precipitation_probability[n] ?? 100) < 30);

  const d = forecast.daily;
  return {
    place: place ? [place.city || place.locality, place.principalSubdivision, place.countryName].filter(Boolean).join(', ') || null : null,
    // The same place as parts, so other pages (mandi prices) can start from the farmer's own state and district.
    region: place ? { city: place.city || place.locality || '', state: place.principalSubdivision || '' } : null,
    elevation: forecast.elevation,
    now: {
      temp: forecast.current.temperature_2m,
      humidity: forecast.current.relative_humidity_2m,
      rain: forecast.current.precipitation,
      wind: forecast.current.wind_speed_10m,
      weather: weatherKey(forecast.current.weather_code),
    },
    soil: {
      moisture: pct(h.soil_moisture_0_to_1cm[i]), // top 1 cm, model estimate
      root: pct(h.soil_moisture_9_to_27cm[i]), // 9-27 cm, where most roots drink
      temp: h.soil_temperature_0cm[i],
    },
    rainInHours,
    sprayWindow,
    sun: { rise: d.sunrise[0], set: d.sunset[0] },
    days: d.time.map((date, n) => ({
      date,
      max: d.temperature_2m_max[n],
      min: d.temperature_2m_min[n],
      rain: d.precipitation_sum[n],
      chance: d.precipitation_probability_max[n],
      et0: d.et0_fao_evapotranspiration[n],
      uv: d.uv_index_max[n],
    })),
    air: air ? { aqi: air.current.us_aqi, pm25: air.current.pm2_5 } : null,
  };
}
