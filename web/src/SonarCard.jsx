import { usePrefs } from './prefs.jsx';

/** Below these distances a side reads as "stop" or "careful". */
const STOP_CM = 25;
const CAREFUL_CM = 60;

export const zoneOf =(cm) => (cm == null ? 'none' : cm < STOP_CM ? 'stop' : cm < CAREFUL_CM ? 'careful' : 'clear');

/**
 * The four ultrasonic sensors on the third ESP32, laid out as seen from above: front on top, back below,
 * left and right beside the rover. A side with no echo has nothing in range (or its sensor is unplugged).
 */
export default function SonarCard({ sonar }) {
  const { t } = usePrefs();
  return (
    <section className="card sonar-card" aria-label={t('sonar.title')}>
      <h2 className="card-title">
        {t('sonar.title')}
        <span className="mono card-note">{(sonar.online ? t('sensors.live') : t('sensors.notConnected')).toUpperCase()}</span>
      </h2>
      <ul className="sonar-grid">
        {['front', 'left', 'right', 'back'].map((side) => {
          const cm = sonar.online ? sonar[side] : null;
          const zone = zoneOf(cm);
          return (
            <li key={side} className="sonar-side" data-side={side} data-zone={zone}>
              <span className="sonar-name">{t(`sonar.${side}`)}</span>
              <strong className="mono sonar-cm">{cm == null ? '—' : `${cm} cm`}</strong>
              <span className="sonar-state">{sonar.online ? t(`sonar.zone.${zone}`) : '—'}</span>
            </li>
          );
        })}
        <li className="sonar-rover" aria-hidden="true">▲</li>
      </ul>
      {!sonar.online && <p className="muted">{t('sonar.offline')}</p>}
    </section>
  );
}
