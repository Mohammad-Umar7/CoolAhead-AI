import { DETECTED } from '../data/footage';
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

/**
 * Share of the people in a room that the detector finds. It misses a few in a
 * dense room, so a count is divided by this to estimate who is really there.
 */
export const recall = (count: number, capacity: number) => 1 - (0.025 + (0.06 * count) / capacity);

const ceil5 = (v: number) => Math.ceil(v / 5) * 5;
/** Seats per room, sized so the class in the room's sample footage fills about three quarters of it. */
const SEATS = DETECTED.map((n) => Math.max(15, ceil5(n * 1.4)));
/** People in each room during a class: the head count from its footage, corrected for the detector's recall. */
export const PRESENT = DETECTED.map((n, i) => Math.min(SEATS[i], Math.round(n / recall(n, SEATS[i]))));

/** Three simulated classrooms on one air handler. Flow shares are fixed by the ductwork. */
export const ROOMS: RoomSpec[] = [
  { id: 'A-301', name: 'Lecture room', capacity: SEATS[0], w: 9, d: 8, h: 3.2, share: 0.31, ua: 48, solar: 950 },
  { id: 'A-302', name: 'Lecture hall', capacity: SEATS[1], w: 12, d: 8, h: 3.2, share: 0.44, ua: 62, solar: 1300 },
  { id: 'A-303', name: 'Seminar room', capacity: SEATS[2], w: 7, d: 8, h: 3.2, share: 0.25, ua: 40, solar: 750 },
];

/** A class as the registrar lists it: enrolment sits a little above or below who turns up on the day. */
const block = (room: number, start: number, end: number, code: string, title: string, history: number, lean: number): ClassBlock => ({
  room,
  start,
  end,
  code,
  title,
  enrolled: Math.min(ROOMS[room].capacity, Math.round((PRESENT[room] * lean) / history)),
  history,
});

/** Sample timetable (the prototype reads this from a CSV). */
export const TIMETABLE: ClassBlock[] = [
  block(0, hm(8, 0), hm(9, 15), 'CSC 201', 'Data Structures', 0.88, 1.06),
  block(0, hm(9, 30), hm(10, 45), 'MTH 210', 'Linear Algebra', 0.84, 1.1),
  block(0, hm(13, 0), hm(14, 15), 'ENG 105', 'Academic Writing', 0.9, 0.96),
  block(0, hm(16, 30), hm(17, 45), 'CSC 330', 'Database Systems', 0.86, 1.0),

  block(1, hm(8, 40), hm(9, 55), 'PHY 110', 'Physics I', 0.87, 1.05),
  block(1, hm(10, 10), hm(11, 25), 'BUS 201', 'Principles of Marketing', 0.83, 0.95),
  block(1, hm(13, 30), hm(14, 45), 'HSC 120', 'Human Anatomy', 0.91, 1.07),

  block(2, hm(9, 0), hm(10, 15), 'ENG 240', 'Technical Communication', 0.86, 1.07),
  block(2, hm(14, 0), hm(15, 15), 'MIS 310', 'Information Systems', 0.88, 0.96),
  block(2, hm(17, 30), hm(18, 45), 'CAP 490', 'Capstone Lab', 0.9, 1.0),
];

/** Things the timetable does not know. They are what the cameras are for. */
export const SURPRISES = {
  /** MTH 210 is cancelled on the day, the timetable still lists it */
  noShowBlock: 1,
  /** an unscheduled guest talk fills A-302 while the timetable shows the zone free */
  surge: { room: 1, start: hm(15, 27), end: hm(16, 15), people: PRESENT[1] },
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
