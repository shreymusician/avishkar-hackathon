import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_MS = 30 * 1000; // the server caches weather, so asking often is cheap; this keeps the rover's position live

/**
 * This device's own location, asked for automatically (the farmer watches from near the land, so the phone is a good
 * stand-in for the field). Resolves to `{ fix: { lat, lon, acc } }` or `{ issue }` saying why not: 'http' (browsers
 * only share a location on https or localhost), 'unsupported', 'denied' (the person or the site settings said no),
 * 'unavailable' (the phone's Location/GPS is off) or 'timeout'. A fix up to 5 minutes old is reused, so polling does
 * not wake the GPS.
 */
function deviceFix() {
  return new Promise((resolve) => {
    if (!window.isSecureContext) return resolve({ issue: 'http' });
    if (!navigator.geolocation) return resolve({ issue: 'unsupported' });
    const done = (p) => resolve({ fix: { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy } });
    const why = (err) => (err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable');
    // Wi-Fi and mobile-network positioning is quick; some browsers (Brave) have it switched off, so when it
    // fails for any reason other than "not allowed" the phone's GPS chip is asked instead.
    navigator.geolocation.getCurrentPosition(
      done,
      (err) => {
        if (err.code === 1) return resolve({ issue: 'denied' });
        navigator.geolocation.getCurrentPosition(done, (e2) => resolve({ issue: why(e2) }), {
          enableHighAccuracy: true,
          timeout: 20000,
          maximumAge: 5 * 60 * 1000,
        });
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 },
    );
  });
}

/**
 * Live field conditions from the server (`/api/environment`). The server picks the position: the rover's own GPS
 * when it has a fix (source 'rover'), otherwise this device's location, sent automatically (source 'phone'), and
 * only when neither is available the network location of this connection (source 'network', city level, often the
 * wrong city). `locationIssue` says why this device's location was not used. The browser never calls third-party
 * APIs itself.
 *
 * status: 'loading' | 'ready' | 'error'
 */
export function useField(accessKey) {
  const [state, setState] = useState({ status: 'loading', source: null, position: null, data: null, updating: false, updatedAt: 0, locationIssue: null });
  const abort = useRef(null);

  const load = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setState((s) => ({ ...s, updating: Boolean(s.data) }));
    try {
      const { fix, issue } = await deviceFix();
      if (controller.signal.aborted) return;
      if (issue) console.info(`[location] this device's location is not used: ${issue}`);
      const headers = { 'x-access-key': accessKey };
      if (fix) headers['x-phone-position'] = `${fix.lat},${fix.lon},${Math.round(fix.acc ?? 0)}`;
      const res = await fetch('/api/environment', { headers, signal: controller.signal });
      if (!res.ok) throw new Error(String(res.status));
      const body = await res.json();
      setState({ status: 'ready', source: body.source, position: body.position, data: body.data, updating: false, updatedAt: Date.now(), locationIssue: issue ?? null });
    } catch {
      if (controller.signal.aborted) return;
      // Keep showing the last good data if there is some; only a first load failure is an error screen.
      setState((s) => ({ ...s, status: s.data ? 'ready' : 'error', updating: false, stale: Boolean(s.data) }));
    }
  }, [accessKey]);

  useEffect(() => {
    load();
    const id = setInterval(() => document.visibilityState === 'visible' && load(), POLL_MS);
    return () => {
      clearInterval(id);
      abort.current?.abort();
    };
  }, [load]);

  return { ...state, refresh: load };
}
