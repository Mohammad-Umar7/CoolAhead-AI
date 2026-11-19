import type { ClassBlock, Mode, ModeSpec, PlantMode, RoomSpec } from './types';

export const hm = (h: number, m = 0) => h * 60 + m;

/** Simulated window. The UI shows 07:00 to 19:00. */
export const T0 = hm(6, 30);
export const T1 = hm(19, 30);
export const STEPS = T1 - T0;
export const VIEW_START = hm(7, 0);
export const VIEW_END = hm(19, 0);
export const DT = 60;

export const COMFORT_LO = 22;
export const COMFORT_HI = 25;

/** Fixed-schedule baseline: the building timer, blind to the timetable. */
export const FIXED = { on: hm(7, 0), off: hm(19, 0), mode: 'TIMER' as PlantMode };
/** A tighter timer some sites use to save energy: cheaper, and warm at both ends of the day. */
export const FIXED_TIGHT = { on: hm(8, 0), off: hm(18, 0), mode: 'TIMER' as PlantMode };

export const DECISION_EVERY = 5;
export const HORIZON = 60;
/** how far past the planning horizon the occupancy forecast reaches */
export const LOOKAHEAD = 45;

export const ZONE = { id: 'AHU-3A', floor: 3, building: 'Block A' };

/** Three simulated classrooms on one air handler. Flow shares are fixed by the ductwork. */
export const ROOMS: RoomSpec[] = [
  { id: 'A-301', name: 'Lecture room', capacity: 40, w: 9, d: 8, h: 3.2, share: 0.31, ua: 48, solar: 950 },
  { id: 'A-302', name: 'Lecture hall', capacity: 60, w: 12, d: 8, h: 3.2, share: 0.44, ua: 62, solar: 1300 },
  { id: 'A-303', name: 'Seminar room', capacity: 30, w: 7, d: 8, h: 3.2, share: 0.25, ua: 40, solar: 750 },
];

/** Sample timetable (the prototype reads this from a CSV). */
export const TIMETABLE: ClassBlock[] = [
  { room: 0, start: hm(8, 0), end: hm(9, 15), code: 'CSC 201', title: 'Data Structures', enrolled: 34, history: 0.88 },
  { room: 0, start: hm(9, 30), end: hm(10, 45), code: 'MTH 210', title: 'Linear Algebra', enrolled: 38, history: 0.84 },
  { room: 0, start: hm(13, 0), end: hm(14, 15), code: 'ENG 105', title: 'Academic Writing', enrolled: 28, history: 0.9 },
  { room: 0, start: hm(16, 30), end: hm(17, 45), code: 'CSC 330', title: 'Database Systems', enrolled: 31, history: 0.86 },

  { room: 1, start: hm(8, 30), end: hm(9, 45), code: 'PHY 110', title: 'Physics I', enrolled: 52, history: 0.87 },
  { room: 1, start: hm(10, 0), end: hm(11, 15), code: 'BUS 201', title: 'Principles of Marketing', enrolled: 47, history: 0.83 },
  { room: 1, start: hm(13, 30), end: hm(14, 45), code: 'HSC 120', title: 'Human Anatomy', enrolled: 55, history: 0.91 },

  { room: 2, start: hm(9, 0), end: hm(10, 15), code: 'ENG 240', title: 'Technical Communication', enrolled: 22, history: 0.86 },
  { room: 2, start: hm(14, 0), end: hm(15, 15), code: 'MIS 310', title: 'Information Systems', enrolled: 25, history: 0.88 },
  { room: 2, start: hm(17, 30), end: hm(18, 45), code: 'CAP 490', title: 'Capstone Lab', enrolled: 14, history: 0.9 },
];

/** Things the timetable does not know. They are what the cameras are for. */
export const SURPRISES = {
  /** MTH 210 is cancelled on the day, the timetable still lists it */
  noShowBlock: 1,
  /** an unscheduled guest talk fills A-302 while the timetable shows the zone free */
  surge: { room: 1, start: hm(15, 27), end: hm(16, 15), people: 44 },
  /** the A-301 camera drops out while it is the only occupied room in the zone */
  cameraOut: { room: 0, start: hm(16, 50), end: hm(17, 25) },
};

export const MODES: Record<PlantMode, ModeSpec> = {
  OFF: { label: 'Off', short: 'OFF', fan: 0, target: 99, steer: 'return' },
  /** fan stopped; only wakes if the zone drifts past the cap */
  STANDBY: { label: 'Standby', short: 'STANDBY', fan: 0, target: 29, steer: 'return' },
  REDUCED: { label: 'Reduced cooling', short: 'REDUCED', fan: 0.7, target: 24.4, steer: 'occupied' },
  NORMAL: { label: 'Normal cooling', short: 'NORMAL', fan: 1, target: 24.4, steer: 'occupied' },
  PRECOOL: { label: 'Pre-cool', short: 'PRE-COOL', fan: 1, target: 23.8, steer: 'upcoming' },
  TIMER: { label: 'Normal cooling', short: 'NORMAL', fan: 1, target: 23.5, steer: 'return' },
};

export const ACTIONS: Mode[] = ['STANDBY', 'REDUCED', 'NORMAL', 'PRECOOL'];

export const AHU = {
  /** design supply air mass flow, kg/s */
  mDesign: 1.8,
  tSupply: 13,
  /** design supply air volume flow, L/s */
  vDesign: 1500,
  /** outdoor-air share of the supply air (fixed damper) */
  oaFraction: 0.35,
  fanDesignKw: 2.2,
  /** moisture removed per kg of outdoor air, J/kg (humid coastal air to a 13 °C coil) */
  latentPerKgOa: 15000,
  /** coil duty per kelvin of error, and per kelvin-minute */
  kp: 2.5,
  ki: 0.25,
};

export const PHYS = {
  cp: 1005,
  rhoCp: 1206,
  /** fast node: room air plus furniture and surface layers, as a multiple of the air alone */
  airMassFactor: 9,
  /** slab and furniture capacity per floor area, J/m2K */
  massPerArea: 250000,
  /** air to surfaces: W/m2K times surface per floor area */
  surfacePerArea: 2,
  hSurface: 3,
  coreUaPerArea: 0.6,
  /** heat leaking between rooms through partitions and doors, W/K per m2 */
  exchangePerArea: 0.9,
  tCore: 25.5,
  solarToMass: 0.7,
  personSensible: 75,
  personLatent: 55,
  lightsOn: 12,
  lightsStandby: 1.5,
};

/** Fresh-air rule for lecture rooms (ASHRAE 62.1 style): per person plus per floor area, L/s. */
export const FRESH_AIR = { perPerson: 3.8, perArea: 0.3 };
export const ZONE_AREA = ROOMS.reduce((a, r) => a + r.w * r.d, 0);
/** Outdoor air delivered at a fan level, L/s. */
export const freshAir = (fan: number) => AHU.oaFraction * fan * AHU.vDesign;
/** Largest head count a fan level can ventilate. */
export const maxPeopleAt = (fan: number) => Math.max(0, (freshAir(fan) - FRESH_AIR.perArea * ZONE_AREA) / FRESH_AIR.perPerson);

export const fmtTime = (t: number) => {
  const m = Math.round(t);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};
