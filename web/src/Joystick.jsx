import { useCallback, useEffect, useRef, useState } from 'react';
import { usePrefs } from './prefs.jsx';
import { Chevron } from './marks.jsx';

const DEAD_ZONE = 0.28; // the middle of the stick's travel counts as "centre": no command
const TRAVEL = 0.34; // how far the knob may move, as a fraction of the base's width

/**
 * A drag stick. While the knob is held away from the centre, the direction is re-sent every 100 ms (useDrive does
 * the repeating, exactly as for the keyboard); dragging into another direction changes it at once, and letting go,
 * dragging back to the centre, or pressing Stop ends it. The rover moves in four directions at full speed, so the
 * stick picks the dominant axis rather than an angle.
 */
export default function Joystick({ enabled, command, press, release, haltCount }) {
  const { t } = usePrefs();
  const base = useRef(null);
  const last = useRef(null); // the direction currently held, for the hysteresis below
  const ignoring = useRef(false); // set by Stop: the held stick is ignored until the finger lifts
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const reset = useCallback(() => {
    last.current = null;
    setKnob({ x: 0, y: 0 });
    setDragging(false);
    release('joystick');
  }, [release]);

  // Not being able to drive (disarmed, link lost, auto navigation) lets go of the stick.
  useEffect(() => {
    if (!enabled) reset();
  }, [enabled, reset]);

  // Stop always wins, even over a stick that is still held.
  const firstHalt = useRef(haltCount);
  useEffect(() => {
    if (haltCount === firstHalt.current) return;
    ignoring.current = true;
    reset();
  }, [haltCount, reset]);

  const update = (event) => {
    const el = base.current;
    if (!el || ignoring.current) return;
    const rect = el.getBoundingClientRect();
    const travel = rect.width * TRAVEL;
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const len = Math.hypot(dx, dy);
    const k = len > travel ? travel / len : 1;
    setKnob({ x: dx * k, y: dy * k });

    if (len / travel < DEAD_ZONE) {
      if (last.current) {
        last.current = null;
        release('joystick');
      }
      return;
    }
    // Pick the dominant axis, but make it a little sticky so a finger wobbling near a diagonal does not flip-flop.
    const prev = last.current;
    const wasHorizontal = prev === 'left' || prev === 'right';
    const wasVertical = prev === 'forward' || prev === 'backward';
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const horizontal = wasHorizontal ? ax > ay * 0.8 : wasVertical ? ax > ay * 1.25 : ax > ay;
    const cmd = horizontal ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'backward' : 'forward';
    last.current = cmd;
    press('joystick', cmd);
  };

  const down = (event) => {
    if (!enabled) return;
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* the pointer is already gone; the drag still counts */
    }
    ignoring.current = false;
    setDragging(true);
    update(event);
  };
  const move = (event) => dragging && update(event);
  const up = () => {
    ignoring.current = false;
    reset();
  };

  const sending = enabled && command !== 'stop';
  const status = !enabled ? t('joy.locked') : sending ? t('joy.sending', { dir: t(`motion.${command}`) }) : t('joy.hint');

  return (
    <div className="joystick-wrap">
      <div
        ref={base}
        className="joystick"
        role="group"
        aria-label={t('joy.label')}
        data-locked={!enabled || undefined}
        data-active={sending || undefined}
        data-dragging={dragging || undefined}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onLostPointerCapture={up}
        onContextMenu={(e) => e.preventDefault()}
      >
        {['forward', 'right', 'backward', 'left'].map((dir) => (
          <span key={dir} className={`joy-arrow ${dir}`} data-on={(sending && command === dir) || undefined} aria-hidden="true">
            <Chevron direction={dir} />
          </span>
        ))}
        <span className="joy-ring" aria-hidden="true" />
        <span className="joy-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} aria-hidden="true" />
      </div>
      <p className="joy-status mono" role="status">
        <span className="joy-led" data-on={sending || undefined} aria-hidden="true" />
        {status}
      </p>
    </div>
  );
}
