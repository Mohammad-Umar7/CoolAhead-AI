import { COMFORT_HI, COMFORT_LO, FRESH_AIR, MODES, ROOMS, ZONE_AREA, fmtTime, freshAir } from './config';
import type { Forecast, Perception } from './forecast';
import { blockAt } from './occupancy';
import type { Mode, PlantState, SafetyCheck } from './types';

export const MIN_DWELL = 15;
const RANK: Record<Mode, number> = { OFF: 0, STANDBY: 1, REDUCED: 2, NORMAL: 3, PRECOOL: 4 };
const atLeast = (m: Mode, floor: Mode): Mode => (RANK[m] >= RANK[floor] ? m : floor);
const atMost = (m: Mode, cap: Mode): Mode => (RANK[m] <= RANK[cap] ? m : cap);

export interface SafetyResult {
  checks: SafetyCheck[];
  proposed: Mode;
  final: Mode;
  overridden: boolean;
  fallback: boolean;
}

/**
 * Last gate before a recommendation is shown. The optimiser may be wrong about
 * the future; these rules only look at what is true now, and they win.
 */
export function safetyCheck(
  proposed: Mode,
  prev: Mode,
  dwell: number,
  t: number,
  state: PlantState,
  p: Perception,
  fc: Forecast,
): SafetyResult {
  const checks: SafetyCheck[] = [];
  let mode = proposed;
  let guard = false;

  // 1. Cameras: a dead feed is not an empty room, and no time to turn cooling down.
  const lost = ROOMS.map((_, i) => i).filter((i) => !p.online[i]);
  const present = ROOMS.map((_, i) => (p.online[i] ? p.smooth[i] : fc.plan[i][0]));
  if (lost.length) {
    const i = lost[0];
    const blk = blockAt(i, t, 8);
    const src = blk ? `timetable (${blk.code}, ${blk.enrolled} enrolled)` : 'timetable';
    const before = `${ROOMS[i].id} feed lost. Using ${src} and last count ${Math.round(p.lastSeen[i].count)} from ${fmtTime(p.lastSeen[i].t)}. Not assumed empty.`;
    if (present[i] >= 1 && RANK[mode] < RANK[prev]) {
      mode = prev;
      guard = true;
      checks.push({ id: 'camera', label: 'Camera health', status: 'fix', detail: `${before} No step-down while blind: ${prev.toLowerCase()} cooling held.` });
    } else {
      checks.push({ id: 'camera', label: 'Camera health', status: 'warn', detail: before });
    }
  } else {
    const worst = Math.min(...p.conf);
    checks.push({ id: 'camera', label: 'Camera health', status: 'pass', detail: `3 of 3 feeds live, lowest confidence ${Math.round(worst * 100)}%.` });
  }

  // 2. Shared zone: nobody loses cooling because a neighbouring room is empty.
  const occupied = present.map((c) => c >= 1);
  const anyone = occupied.some(Boolean);
  if (anyone && RANK[mode] < RANK.REDUCED) {
    const who = ROOMS.filter((_, i) => occupied[i]).map((r) => r.id).join(', ');
    mode = 'REDUCED';
    guard = true;
    checks.push({ id: 'occupied', label: 'Shared zone', status: 'fix', detail: `${who} occupied on this air handler: setback refused, raised to reduced cooling.` });
  } else if (anyone) {
    const empty = ROOMS.filter((_, i) => !occupied[i]).map((r) => r.id);
    checks.push({
      id: 'occupied',
      label: 'Shared zone',
      status: 'pass',
      detail: empty.length ? `${empty.join(', ')} empty but the zone stays on for the occupied rooms.` : 'All three rooms occupied, zone stays on.',
    });
  } else {
    checks.push({ id: 'occupied', label: 'Shared zone', status: 'pass', detail: 'No one detected or expected in any room of the zone.' });
  }

  // 3. Comfort ceiling in occupied rooms.
  let hot = -1;
  for (let i = 0; i < ROOMS.length; i++) if (occupied[i] && (hot < 0 || state.ta[i] > state.ta[hot])) hot = i;
  if (hot >= 0 && state.ta[hot] > COMFORT_HI + 1.3) {
    mode = atLeast(mode, 'PRECOOL');
    guard = guard || mode !== proposed;
    checks.push({ id: 'comfort', label: 'Comfort ceiling', status: mode !== proposed ? 'fix' : 'pass', detail: `${ROOMS[hot].id} at ${state.ta[hot].toFixed(1)} °C with people inside: full cooling required.` });
  } else if (hot >= 0 && state.ta[hot] > COMFORT_HI + 0.5) {
    const before = mode;
    mode = atLeast(mode, 'NORMAL');
    guard = guard || mode !== before;
    checks.push({ id: 'comfort', label: 'Comfort ceiling', status: mode !== before ? 'fix' : 'pass', detail: `${ROOMS[hot].id} at ${state.ta[hot].toFixed(1)} °C, above ${COMFORT_HI} °C: at least normal cooling.` });
  } else {
    checks.push({
      id: 'comfort',
      label: 'Comfort ceiling',
      status: 'pass',
      detail: hot >= 0 ? `Warmest occupied room ${ROOMS[hot].id} at ${state.ta[hot].toFixed(1)} °C, limit ${COMFORT_HI} °C.` : 'No occupied room to protect.',
    });
  }

  // 4. Do not freeze people either.
  let cold = -1;
  for (let i = 0; i < ROOMS.length; i++) if (occupied[i] && (cold < 0 || state.ta[i] < state.ta[cold])) cold = i;
  if (cold >= 0 && state.ta[cold] < COMFORT_LO && RANK[mode] > RANK.NORMAL) {
    mode = atMost(mode, 'NORMAL');
    guard = true;
    checks.push({ id: 'overcool', label: 'Overcooling', status: 'fix', detail: `${ROOMS[cold].id} already at ${state.ta[cold].toFixed(1)} °C: pre-cool refused.` });
  } else {
    checks.push({
      id: 'overcool',
      label: 'Overcooling',
      status: 'pass',
      detail: cold >= 0 ? `Coolest occupied room ${ROOMS[cold].id} at ${state.ta[cold].toFixed(1)} °C, floor ${COMFORT_LO} °C.` : 'No occupied room to protect.',
    });
  }

  // 5. Fresh air: reduced airflow must still ventilate the people who are there.
  let heads = 0;
  for (let i = 0; i < ROOMS.length; i++) heads += p.online[i] ? Math.max(p.smooth[i], present[i]) : fc.hi[i][0];
  const needed = FRESH_AIR.perPerson * heads + FRESH_AIR.perArea * ZONE_AREA;
  if (mode === 'REDUCED' && freshAir(MODES.REDUCED.fan) < needed) {
    mode = 'NORMAL';
    guard = true;
    checks.push({ id: 'air', label: 'Fresh air', status: 'fix', detail: `${Math.round(heads)} people need ${Math.round(needed)} L/s of outdoor air, reduced airflow brings ${Math.round(freshAir(MODES.REDUCED.fan))} L/s: raised to normal.` });
  } else {
    const fan = MODES[mode].fan;
    checks.push({
      id: 'air',
      label: 'Fresh air',
      status: 'pass',
      detail: heads >= 1 ? `${Math.round(heads)} people need ${Math.round(needed)} L/s of outdoor air, this mode brings ${Math.round(freshAir(fan))} L/s.` : 'Zone empty: no ventilation needed while the fan rests.',
    });
  }

  // 6. Equipment: no rapid toggling unless a guard above demanded the change.
  if (mode !== prev && dwell < MIN_DWELL && !guard && prev !== 'OFF') {
    checks.push({ id: 'dwell', label: 'Minimum run time', status: 'fix', detail: `Mode changed ${dwell} min ago: holding ${prev.toLowerCase()} until ${MIN_DWELL} min have passed.` });
    mode = prev;
  } else {
    checks.push({ id: 'dwell', label: 'Minimum run time', status: 'pass', detail: mode === prev ? `No change, ${dwell} min in the current mode.` : `${dwell} min since the last change: switch allowed.` });
  }

  return { checks, proposed, final: mode, overridden: mode !== proposed, fallback: lost.length > 0 };
}
