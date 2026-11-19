import { VIEW_END, VIEW_START } from '../engine/config';
import type { Mode, RunSeries } from '../engine/types';
import { DAY } from '../state/sim';

export interface ModeSpan {
  mode: Mode;
  from: number;
  to: number;
}

/** A run's day as stretches of one mode each, 07:00 to 19:00. */
export function modeSpans(run: RunSeries = DAY.cool): ModeSpan[] {
  const out: ModeSpan[] = [];
  let from = VIEW_START;
  for (let t = VIEW_START + 1; t <= VIEW_END; t++) {
    if (t === VIEW_END || run.mode[t - DAY.t0] !== run.mode[t - 1 - DAY.t0]) {
      out.push({ mode: run.mode[t - 1 - DAY.t0], from, to: t });
      from = t;
    }
  }
  return out;
}

/** Position of a time of day along the 07:00 to 19:00 axis, 0..1. */
export const dayPos = (t: number) => (t - VIEW_START) / (VIEW_END - VIEW_START);
export const HOURS = [7, 9, 11, 13, 15, 17, 19];

export const MODE_LABEL: Record<Mode, string> = {
  OFF: 'Off',
  STANDBY: 'Standby',
  REDUCED: 'Reduced cooling',
  NORMAL: 'Normal cooling',
  PRECOOL: 'Pre-cool',
};

/** Mode colours for canvases and 3D, matching the CSS tokens. */
export const MODE_HEX: Record<Mode, string> = {
  OFF: '#c8ccd4',
  STANDBY: '#9aa1ae',
  REDUCED: '#0d9f6c',
  NORMAL: '#1f5fee',
  PRECOOL: '#7c5cf5',
};
