import { AHU, COMFORT_LO, DT, MODES, PHYS, ROOMS } from './config';
import type { PlantMode, PlantOut, PlantState } from './types';

/** Derived thermal properties per room. */
export const ROOM_PHYS = ROOMS.map((r) => {
  const area = r.w * r.d;
  return {
    area,
    cAir: area * r.h * PHYS.rhoCp * PHYS.airMassFactor,
    cMass: area * PHYS.massPerArea,
    hA: area * PHYS.surfacePerArea * PHYS.hSurface,
    uaCore: area * PHYS.coreUaPerArea,
    exchange: area * PHYS.exchangePerArea,
  };
});

/** Outdoor dry-bulb for the sample design day, °C. t in minutes since midnight. */
export function outdoorTemp(t: number) {
  return 35.2 + 6.3 * Math.cos((2 * Math.PI * (t - 915)) / 1440);
}

/** Normalised solar gain on the south-west glazing, 0..1. */
export function sunFactor(t: number) {
  const x = ((t - 870) * Math.PI) / 660;
  if (x < -Math.PI / 2 || x > Math.PI / 2) return 0;
  return Math.pow(Math.cos(x), 1.3);
}

/** Chiller plant COP falls as it gets hotter outside. */
export function plantCop(tOut: number) {
  return Math.max(2.4, 3.6 - 0.045 * (tOut - 30));
}

export function cloneState(s: PlantState): PlantState {
  return { ta: s.ta.slice(), tm: s.tm.slice(), integ: s.integ };
}

/**
 * Advance the shared zone by one minute.
 *
 * One air handler, one coil and a fixed duct split: every room receives its
 * share of the same supply air whether or not anyone is in it. The only things
 * that can be commanded are the fan level and how hard the coil works.
 *
 * `ref` flags the rooms the coil is steered by. The fixed timer has no such
 * knowledge and steers by the return-air average. CoolAhead steers by the
 * warmest room that has people in it, and backs off before a room that is
 * occupied, or about to be, gets cold.
 */
export function stepPlant(
  s: PlantState,
  mode: PlantMode,
  tOut: number,
  sun: number,
  occ: ArrayLike<number>,
  ref: ArrayLike<number> | null,
  out?: PlantOut,
): void {
  const spec = MODES[mode];
  const n = ROOMS.length;

  let tRet = 0;
  let tAvg = 0;
  for (let i = 0; i < n; i++) {
    tRet += ROOMS[i].share * s.ta[i];
    tAvg += s.ta[i] / n;
  }

  // Control error. A mode steered by occupied rooms has nothing to do in an empty zone.
  let e = tRet - spec.target;
  if (spec.steer !== 'return') {
    e = -2;
    if (ref) {
      // ref: 0 ignore, 1 expected soon (counts while pre-cooling), 2 occupied now
      const need = spec.steer === 'upcoming' ? 0 : 1;
      let hi = -99;
      let lo = 99;
      for (let i = 0; i < n; i++) {
        if (ref[i] > need) hi = Math.max(hi, s.ta[i]);
        if (ref[i] > 0) lo = Math.min(lo, s.ta[i]);
      }
      if (hi > -99) {
        e = hi - spec.target;
        if (lo < 99) e -= 1.5 * Math.max(0, COMFORT_LO + 0.5 - lo);
      }
    }
  }

  let fan = spec.fan;
  if (mode === 'STANDBY') fan = e > 0 || s.integ > 0.02 ? 0.4 : 0;

  let duty = 0;
  if (fan > 0) {
    s.integ = Math.min(1, Math.max(0, s.integ + AHU.ki * e));
    duty = Math.min(1, Math.max(0, AHU.kp * e + s.integ));
  } else {
    s.integ *= 0.85;
  }

  const mDot = fan * AHU.mDesign;
  const tMix = (1 - AHU.oaFraction) * tRet + AHU.oaFraction * tOut;
  const tSup = tMix - duty * (tMix - AHU.tSupply);

  let people = 0;
  for (let i = 0; i < n; i++) {
    const r = ROOMS[i];
    const p = ROOM_PHYS[i];
    const ppl = occ[i];
    people += ppl;
    const lights = (ppl > 0.5 ? PHYS.lightsOn : PHYS.lightsStandby) * p.area;
    const solar = r.solar * sun;
    const qCool = mDot * r.share * PHYS.cp * (s.ta[i] - tSup);
    const qAir =
      r.ua * (tOut - s.ta[i]) +
      p.hA * (s.tm[i] - s.ta[i]) +
      p.exchange * (tAvg - s.ta[i]) +
      ppl * PHYS.personSensible +
      lights +
      solar * (1 - PHYS.solarToMass) -
      qCool;
    const qMass = p.hA * (s.ta[i] - s.tm[i]) + solar * PHYS.solarToMass + p.uaCore * (PHYS.tCore - s.tm[i]);
    s.ta[i] += (qAir * DT) / p.cAir;
    s.tm[i] += (qMass * DT) / p.cMass;
    if (out) out.roomCoolKw[i] = qCool / 1000;
  }

  if (out) {
    const sensible = mDot * PHYS.cp * Math.max(0, tMix - tSup);
    const latent = duty * (mDot * AHU.oaFraction * AHU.latentPerKgOa + people * PHYS.personLatent);
    const coil = (sensible + latent) / 1000;
    const fanKw = AHU.fanDesignKw * fan * fan * fan;
    out.flow = fan;
    out.duty = duty;
    out.tSupply = fan > 0 ? tSup : tRet;
    out.tReturn = tRet;
    out.coilKw = coil;
    out.fanKw = fanKw;
    out.powerKw = fanKw + coil / plantCop(tOut);
  }
}

export function emptyOut(): PlantOut {
  return { flow: 0, duty: 0, tSupply: 0, tReturn: 0, coilKw: 0, fanKw: 0, powerKw: 0, roomCoolKw: [0, 0, 0] };
}

/** Building after a night with the air handler off. */
export function initialState(): PlantState {
  return { ta: [27.3, 27.6, 27.1], tm: [27.4, 27.7, 27.2], integ: 0 };
}
