import { useCallback, useEffect, useRef, useState } from 'react';

/** Re-send cadence while a direction is held. The rover stops 500 ms after the last command. */
const REPEAT_MS = 100;

/**
 * Turns presses (keys and pointers) into drive frames.
 * Several inputs can be held at once; the most recent one wins, and releasing
 * it falls back to whichever is still down, so steering while accelerating
 * does not stutter. Nothing is sent unless `enabled`, and losing the ability
 * to drive (disarm, link loss, tab hidden) always ends in a stop.
 */
export function useDrive({ send, enabled }) {
  const [command, setCommand] = useState('stop');
  const [haltCount, setHaltCount] = useState(0); // counts hard stops, so a held stick can be told to let go
  const held = useRef(new Map()); // input id -> command, insertion order = recency
  const current = useRef('stop');
  const sendRef = useRef(send);
  sendRef.current = send;

  const apply = useCallback((next) => {
    current.current = next;
    setCommand(next);
    sendRef.current({ type: 'drive', command: next });
  }, []);

  const recompute = useCallback(() => {
    const values = [...held.current.values()];
    const next = values.length ? values[values.length - 1] : 'stop';
    if (next !== current.current) apply(next);
  }, [apply]);

  const press = useCallback(
    (id, cmd) => {
      if (!enabled) return;
      held.current.delete(id);
      held.current.set(id, cmd);
      recompute();
    },
    [enabled, recompute],
  );

  const release = useCallback(
    (id) => {
      held.current.delete(id);
      recompute();
    },
    [recompute],
  );

  /** Hard stop: drops every held input. */
  const halt = useCallback(() => {
    setHaltCount((n) => n + 1);
    held.current.clear();
    if (current.current !== 'stop') apply('stop');
    else sendRef.current({ type: 'drive', command: 'stop' });
  }, [apply]);

  // Keep a held direction alive for the rover's failsafe.
  useEffect(() => {
    if (command === 'stop') return undefined;
    const id = setInterval(() => sendRef.current({ type: 'drive', command: current.current }), REPEAT_MS);
    return () => clearInterval(id);
  }, [command]);

  // Anything that removes the operator's ability to drive stops the rover.
  useEffect(() => {
    if (!enabled) {
      held.current.clear();
      if (current.current !== 'stop') apply('stop');
    }
  }, [enabled, apply]);

  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && halt();
    window.addEventListener('blur', halt);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('blur', halt);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [halt]);

  return { command, press, release, halt, haltCount };
}
