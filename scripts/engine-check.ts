// Prints the simulated day so the model can be sanity-checked from the terminal:
//   npx tsx scripts/engine-check.ts
import { FIXED, FIXED_TIGHT, ROOMS, T0, fmtTime, hm } from '../src/engine/config';
import { simulateDay } from '../src/engine/simulate';

const t = performance.now();
const day = simulateDay();
const ms = performance.now() - t;

const row = (label: string, s: typeof day.fixed) =>
  `${label.padEnd(18)} ${s.totalKwh.toFixed(1).padStart(6)} kWh   ${String(Math.round(s.discomfortMin)).padStart(5)} person-min out of band   ${String(s.roomMinutesOut).padStart(4)} room-min`;

console.log(`simulated in ${ms.toFixed(0)} ms, ${day.decisions.length} decisions`);
console.log(row(`fixed ${fmtTime(FIXED.on)}-${fmtTime(FIXED.off)}`, day.fixed));
console.log(row(`tight ${fmtTime(FIXED_TIGHT.on)}-${fmtTime(FIXED_TIGHT.off)}`, day.tight));
console.log(row('coolahead', day.cool));
console.log(`saving ${(100 * (1 - day.cool.totalKwh / day.fixed.totalKwh)).toFixed(1)} %\n`);

console.log('time   out   occ          est          | fixed: mode  fan  sup   A301  A302  A303   kW | cool: mode     fan  sup   A301  A302  A303   kW');
for (let m = hm(6, 30); m <= hm(19, 30); m += 15) {
  const k = m - T0;
  const f = day.fixed;
  const c = day.cool;
  const occ = ROOMS.map((_, i) => String(day.occ[i][k]).padStart(3)).join(' ');
  const est = ROOMS.map((_, i) => String(day.est[i][k]).padStart(3)).join(' ');
  const temps = (s: typeof f) => ROOMS.map((_, i) => s.ta[i][k].toFixed(1).padStart(5) + (s.outOfBand[i][k] ? '*' : ' ')).join('');
  console.log(
    `${fmtTime(m)} ${day.tOut[k].toFixed(1)}  ${occ}  ${est}  | ${f.mode[k].padEnd(8)} ${f.flow[k].toFixed(1)} ${f.tSupply[k].toFixed(1)} ${temps(f)} ${f.power[k].toFixed(1).padStart(5)} | ${c.mode[k].padEnd(8)} ${c.flow[k].toFixed(1)} ${c.tSupply[k].toFixed(1)} ${temps(c)} ${c.power[k].toFixed(1).padStart(5)}`,
  );
}

{
  console.log('');
  console.log('coolahead mode segments:');
  let from = hm(6, 30);
  const c = day.cool;
  const segs: string[] = [];
  for (let k = 1; k <= day.steps; k++) {
    if (k === day.steps || c.mode[k] !== c.mode[k - 1]) {
      segs.push(`${fmtTime(from)} ${c.mode[k - 1]} (${T0 + k - from}m)`);
      from = T0 + k;
    }
  }
  console.log(segs.join('  |  '));
  const out: string[] = [];
  for (let i = 0; i < ROOMS.length; i++) for (let k = 0; k <= day.steps; k++) if (c.outOfBand[i][k]) out.push(`${ROOMS[i].id}@${fmtTime(T0 + k)}=${c.ta[i][k].toFixed(2)}`);
  console.log('coolahead out of band:', out.join(' ') || 'none');
}

if (process.argv.includes('--decisions')) {
  console.log('');
  let last = '';
  for (const d of day.decisions) {
    const key = d.mode + d.report.tag + d.report.headline.replace(/\d+/g, '#');
    if (key === last) continue;
    last = key;
    console.log(`${fmtTime(d.t)}  [${d.mode}] ${d.report.headline}`);
    console.log(`        ${d.report.reason}`);
    for (const f of d.report.facts) console.log(`        - ${f}`);
  }
}
