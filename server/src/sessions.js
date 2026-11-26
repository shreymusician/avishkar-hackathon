// A drive session is one dashboard connection. The tracker turns the stream of
// commands into a summary: how long each direction was held and how many times
// the operator changed direction. Time is injected so it can be tested.

const DIRECTIONS = ['forward', 'backward', 'left', 'right'];

export class SessionTracker {
  /** @param {number} now epoch ms */
  constructor(now) {
    this.startedAt = now;
    this.commands = 0;
    this.lightToggles = 0;
    this.driveMs = Object.fromEntries(DIRECTIONS.map((d) => [d, 0]));
    this.current = 'stop';
    this.since = now;
  }

  /** Repeats of the held command are not counted; only changes are. */
  onCommand(command, now) {
    if (command === this.current) return;
    this.#close(now);
    this.current = command;
    this.since = now;
    if (command !== 'stop') this.commands += 1;
  }

  onLight() {
    this.lightToggles += 1;
  }

  #close(now) {
    if (this.current !== 'stop') this.driveMs[this.current] += Math.max(0, now - this.since);
  }

  /** @returns {null | object} null when the operator never moved or toggled anything */
  end(now) {
    this.#close(now);
    this.current = 'stop';
    if (this.commands === 0 && this.lightToggles === 0) return null;
    return {
      startedAt: new Date(this.startedAt),
      endedAt: new Date(now),
      commands: this.commands,
      lightToggles: this.lightToggles,
      driveMs: { ...this.driveMs },
      totalDriveMs: DIRECTIONS.reduce((sum, d) => sum + this.driveMs[d], 0),
    };
  }
}
