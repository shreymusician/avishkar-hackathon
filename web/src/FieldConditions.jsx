import { adviceFor } from './field.js';
import { useField } from './useField.js';
import { usePrefs } from './prefs.jsx';
import { SensorMark } from './marks.jsx';

const num = (v, digits = 0) => (v == null ? '—' : Number(v).toFixed(digits));

/**
 * Weather, soil and farm prompts for the field. The server chooses the position (the rover's GPS when it
 * has a fix, otherwise the network's city-level location) and does the lookups; this only shows them.
 */
export default function FieldConditions({ accessKey }) {
  const { t, locale } = usePrefs();
  const field = useField(accessKey);
  const { status, data, source, position, updating, updatedAt } = field;
  const busy = status === 'loading' || updating;
  const live = source === 'rover';
  const phone = source === 'phone';

  const dayName = (iso, n) =>
    n === 0 ? t('field.today') : new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { weekday: 'short' });
  const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '—');

  const nextRain =
    data == null
      ? null
      : data.rainInHours == null
        ? t('field.rainNone')
        : data.rainInHours === 0
          ? t('field.rainNow')
          : t('field.rainIn', { n: data.rainInHours });

  return (
    <section className="card c-cond" aria-label={t('field.title')}>
      <h2 className="card-title">
        {t('field.title')}
        <span className="mono card-note" data-source={live || phone ? 'gps' : undefined}>
          {live ? t('field.roverGps').toUpperCase() : phone ? t('field.phoneGps').toUpperCase() : source === 'network' ? t('field.netApprox').toUpperCase() : ''}
        </span>
      </h2>

      {status === 'loading' && !data && <p className="muted mono">{t('field.loading').toUpperCase()}</p>}

      {status === 'error' && (
        <div className="locate" role="alert">
          <p className="locate-text">{t('field.err.load')}</p>
          <button type="button" className="plain" onClick={field.refresh}>
            {t('field.retry')}
          </button>
        </div>
      )}

      {source === 'network' && (
        <div className="locate" role="status">
          <p className="locate-text">
            {{ http: t('field.notice.http'), denied: t('field.notice.denied'), unavailable: t('field.notice.unavailable'), timeout: t('field.notice.timeout') }[field.locationIssue] ??
              t('field.notice.noGps')}
          </p>
        </div>
      )}

      {data && (
        <>
          <p className="place">
            <strong>{data.place ?? `${num(position.lat, 3)}, ${num(position.lon, 3)}`}</strong>
            <span className="mono">
              {(live || phone) && position.accuracy != null && position.accuracy > 0 && `${t('field.accuracy', { n: position.accuracy })} · `}
              {live && position.sats != null && `${t('field.sats', { n: position.sats })} · `}
              {t('field.elev', { n: num(data.elevation) }).toUpperCase()}
            </span>
            {live && (
              <span className="live mono">
                <span className="dot" aria-hidden="true" />
                {t('field.live').toUpperCase()}
              </span>
            )}
          </p>

          <div className="now">
            <p className="now-temp">
              {num(data.now.temp)}
              <span>&deg;C</span>
            </p>
            <p className="now-text">{t(data.now.weather)}</p>
          </div>

          <ul className="sensors cond">
            <Tile kind="humidity" name={t('field.humidity')} value={`${num(data.now.humidity)} %`} />
            <Tile kind="rain" name={t('field.nextRain')} value={nextRain} />
            <Tile kind="soil" name={t('field.soilMoisture')} value={data.soil.moisture == null ? '—' : `${data.soil.moisture} %`} />
            <Tile kind="soil" name={t('field.rootZone')} value={data.soil.root == null ? '—' : `${data.soil.root} %`} />
            <Tile kind="temperature" name={t('field.soilTemp')} value={`${num(data.soil.temp)} °C`} />
            <Tile kind="wind" name={t('field.wind')} value={`${num(data.now.wind)} km/h`} />
            <Tile kind="air" name={t('field.air')} value={data.air ? `AQI ${data.air.aqi}` : '—'} />
            <Tile kind="sun" name={t('field.sun')} value={`${clock(data.sun.rise)} / ${clock(data.sun.set)}`} />
          </ul>

          <h3 className="sub-title mono">{t('field.next3').toUpperCase()}</h3>
          <ol className="forecast">
            {data.days.map((day, n) => (
              <li key={day.date}>
                <span className="fc-day">{dayName(day.date, n)}</span>
                <span className="fc-temp mono">
                  {num(day.max)}&deg; / {num(day.min)}&deg;
                </span>
                <span className="fc-rain mono">
                  {num(day.rain, 1)} mm &middot; {num(day.chance)}%
                </span>
              </li>
            ))}
          </ol>

          <h3 className="sub-title mono">{t('field.forField').toUpperCase()}</h3>
          <ul className="advice">
            {adviceFor(data).map((a) => (
              <li key={a.key} data-level={a.level}>
                <strong>{t(`advice.${a.key}.title`)}</strong>
                <span>{t(`advice.${a.key}.text`)}</span>
              </li>
            ))}
          </ul>

          <div className="cond-foot">
            <button type="button" className="ghost" disabled={busy} onClick={field.refresh}>
              {busy ? t('field.updating') : t('field.refresh')}
            </button>
            <p className="muted">
              {updatedAt ? `${t('field.updated', { time: clock(updatedAt) })}. ` : ''}
              {t('field.note')}{' '}
              <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
                Open-Meteo
              </a>
              .
            </p>
          </div>
          {field.stale && (
            <p className="notice mono" role="alert">
              {t('field.err.load').toUpperCase()}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Tile({ kind, name, value }) {
  return (
    <li className="sensor">
      <SensorMark kind={kind} />
      <span className="sensor-name">{name}</span>
      <span className="sensor-value mono">{value}</span>
    </li>
  );
}
