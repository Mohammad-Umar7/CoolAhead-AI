import { useEffect, useMemo, useState } from 'react';
import { COMFORT_HI, COMFORT_LO, FIXED, FIXED_TIGHT, VIEW_END, VIEW_START, fmtTime } from '../engine/config';
import { HOURS, dayPos, modeSpans } from '../lib/day';
import { SCENES } from '../loop/cycle';
import { ZONES } from '../scenes/building/model';
import { DAY } from '../state/sim';
import { ModeLegend } from '../ui/Ribbon';

const W = 1376;
const LABEL = 132;
const CHART = W - LABEL;
const TEACHING_DAYS = 180;

/** A number that counts up once, when the page opens. */
function useCount(target: number, ms = 1400, delay = 250) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now() + delay;
    const tick = (now: number) => {
      const u = Math.min(1, Math.max(0, (now - t0) / ms));
      setV(target * (1 - Math.pow(1 - u, 3)));
      if (u < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, delay]);
  return v;
}

/** Stretches of the timer's day in which it cools a zone with nobody in it. */
function emptySpans() {
  const out: { from: number; to: number }[] = [];
  let from = -1;
  for (let t = FIXED.on; t <= FIXED.off; t++) {
    const k = t - DAY.t0;
    const empty = t < FIXED.off && DAY.occ[0][k] + DAY.occ[1][k] + DAY.occ[2][k] < 1;
    if (empty && from < 0) from = t;
    if (!empty && from >= 0) {
      if (t - from >= 8) out.push({ from, to: t });
      from = -1;
    }
  }
  return out;
}

export default function Impact() {
  const fixed = DAY.fixed.totalKwh;
  const cool = DAY.cool.totalKwh;
  const saved = fixed - cool;
  const share = Math.round((saved / fixed) * 100);
  const [go, setGo] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setGo(true), 120);
    return () => window.clearTimeout(id);
  }, []);
  const nFixed = useCount(fixed);
  const nCool = useCount(cool);
  const nShare = useCount(share, 1500, 500);

  const spans = useMemo(() => modeSpans(), []);
  const waste = useMemo(emptySpans, []);
  const wasted = waste.reduce((a, s) => a + (s.to - s.from), 0);
  const people = useMemo(() => {
    const pts: string[] = [];
    let top = 1;
    for (let t = VIEW_START; t <= VIEW_END; t += 2) top = Math.max(top, DAY.occ[0][t - DAY.t0] + DAY.occ[1][t - DAY.t0] + DAY.occ[2][t - DAY.t0]);
    for (let t = VIEW_START; t <= VIEW_END; t += 2) {
      const n = DAY.occ[0][t - DAY.t0] + DAY.occ[1][t - DAY.t0] + DAY.occ[2][t - DAY.t0];
      pts.push(`${(dayPos(t) * CHART).toFixed(1)} ${(64 - (n / top) * 58).toFixed(1)}`);
    }
    return { line: `M${pts.join('L')}`, area: `M0 64L${pts.join('L')}L${CHART} 64Z`, top };
  }, []);
  const pct = (t: number) => `${(dayPos(t) * 100).toFixed(3)}%`;
  const yearly = (saved * ZONES * TEACHING_DAYS) / 1000;

  return (
    <div className={`page impact${go ? ' go' : ''}`}>
      <header className="imp-head" style={{ width: W }}>
        <p className="imp-kicker">Same day, same people, same building</p>
        <h1>
          <em>{Math.round(nShare)}% less energy</em> than a fixed timer, and nobody sat in a warm room.
        </h1>
      </header>

      <section className="imp-race" style={{ width: W }}>
        <div className="imp-bar before">
          <span className="imp-who">
            Before
            <b>Fixed timer, {fmtTime(FIXED.on)} to {fmtTime(FIXED.off)}</b>
          </span>
          <i>
            <b style={{ width: go ? '100%' : '0%' }} />
          </i>
          <strong className="num">
            {nFixed.toFixed(0)}
            <small>kWh</small>
          </strong>
        </div>
        <div className="imp-bar after">
          <span className="imp-who">
            After
            <b>CoolAhead recommendations</b>
          </span>
          <i>
            <b style={{ width: go ? `${(cool / fixed) * 100}%` : '0%' }} />
            <u style={{ left: `${(cool / fixed) * 100}%`, width: `${(1 - cool / fixed) * 100}%` }}>saved {saved.toFixed(0)} kWh</u>
          </i>
          <strong className="num">
            {nCool.toFixed(0)}
            <small>kWh</small>
          </strong>
        </div>
      </section>

      <section className="imp-day" style={{ width: W }}>
        <h2>Where the saving comes from</h2>
        <div className="imp-row people">
          <span>People in the zone</span>
          <svg viewBox={`0 0 ${CHART} 64`} width={CHART} height={64} preserveAspectRatio="none" aria-hidden="true">
            <path className="imp-area" d={people.area} />
            <path className="imp-line" d={people.line} />
          </svg>
        </div>
        <div className="imp-row">
          <span>Fixed timer</span>
          <div className="imp-strip timer">
            <i style={{ left: pct(FIXED.on), width: `calc(${pct(FIXED.off)} - ${pct(FIXED.on)})` }} />
            {waste.map((s, i) => (
              <b key={i} style={{ left: pct(s.from), width: `calc(${pct(s.to)} - ${pct(s.from)})`, transitionDelay: `${0.9 + i * 0.12}s` }}>
                {s.to - s.from >= 75 ? 'cooling an empty zone' : ''}
              </b>
            ))}
          </div>
        </div>
        <div className="imp-row">
          <span>CoolAhead</span>
          <div className="imp-strip">
            {spans.map((s, i) => (
              <i key={i} data-mode={s.mode} style={{ left: pct(s.from), width: `calc(${pct(s.to)} - ${pct(s.from)})` }} />
            ))}
            {SCENES.map((s, i) => (
              <em key={s.id} style={{ left: pct(s.t) }} title={s.flag}>
                {i + 1}
              </em>
            ))}
          </div>
        </div>
        <div className="imp-row axis">
          <span />
          <div>
            {HOURS.map((h) => (
              <em key={h} style={{ left: pct(h * 60) }}>
                {String(h).padStart(2, '0')}:00
              </em>
            ))}
          </div>
        </div>
        <div className="imp-keys">
          <span className="imp-key-waste">
            <i />
            The timer cools the zone for {Math.floor(wasted / 60)} h {wasted % 60} min with nobody in it
          </span>
          <ModeLegend />
        </div>
      </section>

      <section className="imp-facts" style={{ width: W }}>
        <div>
          <strong className="num">{DAY.cool.roomMinutesOut}</strong>
          <p>
            minutes outside {COMFORT_LO} to {COMFORT_HI} °C in an occupied room, all day
          </p>
        </div>
        <div>
          <strong className="num">{DAY.tight.roomMinutesOut}</strong>
          <p>
            warm minutes if you just shorten the timer to {fmtTime(FIXED_TIGHT.on)} to {fmtTime(FIXED_TIGHT.off)} instead. It saves less ({Math.round((1 - DAY.tight.totalKwh / fixed) * 100)}%)
          </p>
        </div>
        <div>
          <strong className="num">
            {yearly.toFixed(0)}
            <small>MWh</small>
          </strong>
          <p>
            a year if all {ZONES} zones of the building did the same on {TEACHING_DAYS} teaching days. An illustration, not a measurement
          </p>
        </div>
        <p className="imp-fine">Modelled on one simulated zone of three classrooms. These are not measured savings for Liwa University, and no building system is controlled.</p>
      </section>
    </div>
  );
}
