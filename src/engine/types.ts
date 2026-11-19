export type Mode = 'OFF' | 'STANDBY' | 'REDUCED' | 'NORMAL' | 'PRECOOL';
/** TIMER is the fixed schedule's only running state: full fan, return-air thermostat. */
export type PlantMode = Mode | 'TIMER';

export interface RoomSpec {
  id: string;
  name: string;
  capacity: number;
  /** interior width (x), depth (z), height in metres */
  w: number;
  d: number;
  h: number;
  /** fixed share of the zone's supply air: the shared-zone constraint */
  share: number;
  /** envelope conductance to outdoors, W/K */
  ua: number;
  /** peak solar gain through the glazing, W */
  solar: number;
}

export interface ClassBlock {
  room: number;
  /** minutes since midnight */
  start: number;
  end: number;
  code: string;
  title: string;
  enrolled: number;
  /** attendance share seen over previous weeks (sample history) */
  history: number;
}

export interface ModeSpec {
  label: string;
  short: string;
  /** fan level, share of design airflow */
  fan: number;
  /** temperature the coil is steered to, °C */
  target: number;
  /** what the coil is steered by */
  steer: 'return' | 'occupied' | 'upcoming';
}

export type Basis = 'timetable' | 'observed' | 'no-show' | 'unscheduled' | 'fallback' | 'empty';

export interface PlantState {
  ta: number[];
  tm: number[];
  integ: number;
}

export interface PlantOut {
  flow: number;
  /** coil duty, 0..1 */
  duty: number;
  tSupply: number;
  tReturn: number;
  coilKw: number;
  fanKw: number;
  powerKw: number;
  roomCoolKw: number[];
}

export interface Candidate {
  a: Mode;
  b: Mode;
  /** minutes until the switch from a to b (0 = constant plan) */
  k: number;
  /** optional third stage: mode c from minute k2 */
  c: Mode | null;
  k2: number;
  energy: number;
  discomfort: number;
  /** the same measure against a stricter limit, used when stepping down */
  tight: number;
  /** energy plus a charge per mode change, kWh */
  cost: number;
  /** keeps every occupied room inside the band, with margin, for the whole hour */
  comfortable: boolean;
  /** warmest occupied room over the hour: temperature, room and minutes ahead */
  peak: number;
  peakRoom: number;
  peakAt: number;
  /** predicted room air temperature at +15, +30, +45 and +60 min */
  temps: number[][];
}

export interface SafetyCheck {
  id: 'occupied' | 'camera' | 'comfort' | 'overcool' | 'air' | 'dwell';
  label: string;
  /** pass: nothing to do. warn: handled with a fallback. fix: the plan was changed. */
  status: 'pass' | 'warn' | 'fix';
  detail: string;
}

export interface Decision {
  t: number;
  vision: {
    count: (number | null)[];
    conf: number[];
    online: boolean[];
  };
  forecast: {
    /** per room, occupancy at +0..+60 min in 5 min steps */
    occ: number[][];
    lo: number[][];
    hi: number[][];
    basis: Basis[];
    /** zone cooling demand, kW thermal, same grid */
    demand: number[];
    demandLo: number[];
    demandHi: number[];
    next: { room: number; code: string; title: string; start: number; expected: number } | null;
  };
  candidates: Candidate[];
  chosen: number;
  /** what simply holding each mode for the hour would do */
  hold: Partial<Record<Mode, Candidate>>;
  safety: {
    checks: SafetyCheck[];
    proposed: Mode;
    final: Mode;
    overridden: boolean;
    fallback: boolean;
  };
  report: {
    headline: string;
    reason: string;
    facts: string[];
    tag: 'precool' | 'hold' | 'reduce' | 'normal' | 'boost' | 'fallback';
  };
  mode: Mode;
  /** when the plan intends to change mode, minutes since midnight */
  planSwitchAt: number | null;
  planNext: Mode | null;
}

export interface RunSeries {
  /** per minute */
  ta: Float32Array[];
  tm: Float32Array[];
  flow: Float32Array;
  duty: Float32Array;
  tSupply: Float32Array;
  tReturn: Float32Array;
  power: Float32Array;
  coil: Float32Array;
  energy: Float32Array;
  /** person-minutes outside the comfort band, cumulative */
  discomfort: Float32Array;
  /** 1 when an occupied room is outside the band */
  outOfBand: Uint8Array[];
  mode: Mode[];
  totalKwh: number;
  discomfortMin: number;
  /** minutes with at least one occupied room outside the band */
  roomMinutesOut: number;
}

export interface DayEvent {
  id: 'precool' | 'noshow' | 'allempty' | 'surge' | 'camera' | 'evening';
  label: string;
  short: string;
  t: number;
  end: number;
  room: number | null;
  note: string;
}

export interface DayResult {
  t0: number;
  steps: number;
  tOut: Float32Array;
  sun: Float32Array;
  occ: Float32Array[];
  est: Float32Array[];
  conf: Float32Array[];
  online: Uint8Array[];
  /** the fixed schedule used in the side-by-side */
  fixed: RunSeries;
  /** a tighter timer, for reference */
  tight: RunSeries;
  cool: RunSeries;
  decisions: Decision[];
  events: DayEvent[];
}
