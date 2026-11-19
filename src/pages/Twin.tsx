import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { OrbitControls } from '@react-three/drei';
import { COMFORT_HI, COMFORT_LO, MODES, ROOMS, fmtTime } from '../engine/config';
import { decisionAt } from '../engine/simulate';
import { MODE_LABEL } from '../lib/day';
import { SCENES, useCycle } from '../loop/cycle';
import type { AnchorEls } from '../scenes/Anchors';
import LightStage, { Rig, type Shot } from '../scenes/LightStage';
import { IdleSway } from '../scenes/Stage';
import Building, { type Layer } from '../scenes/building/Building';
import { FLOORS, HEAT_CSS, HEIGHT, SPOTS, TEMP_CSS, ZONES, liveIndex, sampleBuilding } from '../scenes/building/model';
import { DAY, at, useMinute, useSim } from '../state/sim';
import Ribbon from '../ui/Ribbon';

type Scope = 'building' | 'zone';

const LIVE = SPOTS[liveIndex];
const WHOLE: Shot = { target: [0, HEIGHT * 0.47, 0], from: [-0.62, 0.34, 0.71], span: 100, rise: 66 };
const INSIDE: Shot = { target: [LIVE.x + 9.6, LIVE.y + 0.6, LIVE.z + 9.8], from: [-0.46, 0.7, 0.55], span: 31, rise: 25 };
const RATES = [
  { label: 'Slow', speed: 1.5 },
  { label: 'Normal', speed: 5 },
  { label: 'Fast', speed: 18 },
];
const LAYERS: { id: Layer; label: string }[] = [
  { id: 'temp', label: 'Temperature' },
  { id: 'heat', label: 'People heat map' },
  { id: 'xray', label: 'X-ray' },
];
const SHARE = ROOMS.map((r) => Math.round(r.share * 100));

/** The building in a few numbers: who is inside, and what cooling them draws right now. */
function Whole() {
  const minute = useMinute();
  const b = useMemo(() => sampleBuilding(minute), [minute]);
  const top = Math.max(b.fixedKw, b.coolKw, 1);
  const running = ZONES - b.modes.STANDBY - b.modes.OFF;
  return (
    <aside className="twin-card">
      <h2>The whole building</h2>
      <p className="twin-sub">
        {FLOORS} floors, {ZONES} cooling zones
      </p>
      <div className="twin-big">
        <strong className="num">{b.people.toLocaleString()}</strong>
        <span>people inside at {fmtTime(minute)}</span>
      </div>
      <div className="twin-vs">
        <span className="twin-vs-k">Cooling power right now</span>
        <div>
          <span>Fixed timer</span>
          <i>
            <b style={{ width: `${(b.fixedKw / top) * 100}%` }} />
          </i>
          <strong className="num">{Math.round(b.fixedKw)} kW</strong>
        </div>
        <div className="cool">
          <span>CoolAhead</span>
          <i>
            <b style={{ width: `${(b.coolKw / top) * 100}%` }} />
          </i>
          <strong className="num">{Math.round(b.coolKw)} kW</strong>
        </div>
      </div>
      <p className="twin-note">
        {running} of {ZONES} zones are cooling. Level 3 west is the simulated zone; the other {ZONES - 1} replay it with shifted timetables to show the idea at building scale.
      </p>
    </aside>
  );
}

const RANK = { OFF: 0, STANDBY: 0, REDUCED: 1, NORMAL: 2, PRECOOL: 3 } as const;

/**
 * The simulated zone, as the cameras tally it: how many people each room holds
 * right now, and what the air handler does about it. When people leave, the
 * tally drops and the cooling follows.
 */
function Inside({ applied, onNext }: { applied: number | null; onNext: () => void }) {
  const minute = useMinute();
  const d = decisionAt(DAY, minute);
  const rooms = ROOMS.map((r, i) => ({ id: r.id, n: Math.round(at(DAY.occ[i], minute)), seats: r.capacity, online: DAY.online[i][Math.min(DAY.steps, minute - DAY.t0)] === 1 }));
  const total = rooms.reduce((sum, r) => sum + r.n, 0);
  // which way the cooling last moved
  let way: 'up' | 'down' | 'hold' = 'hold';
  for (let i = DAY.decisions.indexOf(d) - 1; i >= 0; i--) {
    const before = DAY.decisions[i].mode;
    if (before === d.mode) continue;
    way = RANK[d.mode] > RANK[before] ? 'up' : 'down';
    break;
  }
  const fan = Math.round(MODES[d.mode].fan * 100);
  return (
    <aside className="twin-card">
      <p className="twin-step">{applied !== null ? `Situation ${applied + 1} of ${SCENES.length}, running in the building` : 'Level 3, zone AHU-3A'}</p>
      <div className="tally">
        <strong className="num">{total}</strong>
        <span>
          people counted
          <br />
          by the cameras right now
        </span>
      </div>
      <ul className="tally-rooms">
        {rooms.map((r) => (
          <li key={r.id} className={r.online ? '' : 'down'}>
            <span>{r.id}</span>
            <i>
              <b style={{ width: `${Math.min(100, (r.n / r.seats) * 100)}%` }} />
            </i>
            <strong className="num">{r.online ? r.n : '?'}</strong>
          </li>
        ))}
      </ul>
      <div className="twin-mode" data-mode={d.mode}>
        <i className={way}>
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <path d={way === 'hold' ? 'M2.5 6h7' : 'M6 2.2v7.6M2.6 5.6 6 2.2l3.4 3.4'} />
          </svg>
        </i>
        <div>
          <span>{way === 'up' ? 'Cooling goes up' : way === 'down' ? 'Cooling goes down' : 'Cooling holds'}</span>
          <strong>{MODES[d.mode].label}</strong>
        </div>
        <em className="num">{fan}%</em>
      </div>
      <p className="twin-safe">
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <path d="M3.2 5.4V4a2.8 2.8 0 0 1 5.6 0v1.4M2.4 5.4h7.2v4.8H2.4z" />
        </svg>
        Counted on the camera. No video is stored or sent, only these numbers.
      </p>
      {applied !== null && (
        <button className="btn primary twin-next" onClick={onNext}>
          {applied + 1 < SCENES.length ? 'Next situation' : 'See the whole day'}
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M2 8h11M9 3.5 13.5 8 9 12.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </aside>
  );
}

/** Labels pinned to the model. They are ordinary HTML, moved each frame by the scene. */
function Tags({ els, scope, layer }: { els: React.RefObject<AnchorEls>; scope: Scope; layer: Layer }) {
  const minute = useMinute();
  const pin = (key: string) => (el: HTMLDivElement | null) => {
    els.current[key] = el;
  };
  return (
    <div className={`twin-tags is-${scope}`} aria-hidden="true">
      <div className="tag-pin for-building" ref={pin('live')}>
        <span className="tag live">
          <b>Level 3 west</b>
          the simulated zone
        </span>
      </div>
      {ROOMS.map((r, i) => {
        const people = Math.round(at(DAY.occ[i], minute));
        const temp = at(DAY.cool.ta[i], minute);
        const warm = temp > COMFORT_HI;
        return (
          <div key={r.id} className="tag-pin for-zone" ref={pin(`room${i}`)}>
            <span className="tag room">
              <b>{r.id}</b>
              {layer === 'heat' ? `${people} ${people === 1 ? 'person' : 'people'}` : layer === 'xray' ? `${SHARE[i]}% of the air` : <em className={warm ? 'warm' : ''}>{temp.toFixed(1)} °C</em>}
            </span>
          </div>
        );
      })}
      <div className="tag-pin for-zone" ref={pin('ahu')}>
        <span className="tag room">
          <b>AHU-3A</b>
          one air handler
        </span>
      </div>
    </div>
  );
}

function Legend({ layer }: { layer: Layer }) {
  return (
    <div className="twin-legend">
      {layer === 'xray' ? (
        <p className="twin-xray">
          <b>One air handler per zone, three rooms each.</b> The ducts split its air in fixed shares, so an empty room is cooled whenever its neighbours are.
        </p>
      ) : (
        <>
          <div className="twin-ramp">
            <span>{layer === 'heat' ? 'Empty' : 'Cool'}</span>
            <i style={{ background: layer === 'heat' ? HEAT_CSS : TEMP_CSS }} />
            <span>{layer === 'heat' ? 'Full' : 'Warm'}</span>
          </div>
          <p>{layer === 'heat' ? 'How full each room is, from the camera counts' : `Room air. Comfort is ${COMFORT_LO} to ${COMFORT_HI} °C, the green part`}</p>
        </>
      )}
      <ul>
        {(['STANDBY', 'PRECOOL', 'REDUCED', 'NORMAL'] as const).map((m) => (
          <li key={m} data-mode={m}>
            <i />
            {MODE_LABEL[m]}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TimeBar() {
  const playing = useSim((s) => s.playing);
  const speed = useSim((s) => s.speed);
  const minute = useMinute();
  const flags = useMemo(() => SCENES.map((s) => ({ label: s.flag, t: s.t })), []);
  const active = SCENES.findIndex((s, i) => minute >= s.t - 2 && minute < (SCENES[i + 1]?.t ?? 9999) && minute < s.t + 40);
  return (
    <div className="twin-time">
      <button className="icon-btn big" onClick={() => useSim.getState().toggle()} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? (
          <svg viewBox="0 0 16 16" width="15" height="15">
            <path d="M5.5 3.5v9M10.5 3.5v9" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" width="15" height="15">
            <path d="M5.5 3.2 12.5 8l-7 4.8z" fill="currentColor" />
          </svg>
        )}
      </button>
      <Ribbon width={1090} t={minute} flags={flags} active={active} onFlag={(i) => useSim.getState().jump(SCENES[i].t + 2)} onPick={(t) => useSim.getState().set(t)} />
      <div className="seg">
        {RATES.map((r) => (
          <button key={r.label} aria-pressed={speed === r.speed} onClick={() => useSim.getState().setSpeed(r.speed)}>
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Twin() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const from = params.get('applied');
  const applied = from !== null && SCENES[Number(from)] ? Number(from) : null;
  // a link can open the twin on a particular view: ?scope=zone&layer=xray&t=600
  const [scope, setScope] = useState<Scope>(params.get('scope') === 'zone' ? 'zone' : 'building');
  const [layer, setLayer] = useState<Layer>((['temp', 'heat', 'xray'] as Layer[]).find((l) => l === params.get('layer')) ?? 'temp');
  const tags = useRef<AnchorEls>({});

  useEffect(() => {
    if (applied === null) {
      // the agents page holds the clock still on one decision; here the day runs
      const t = Number(params.get('t'));
      useSim.setState({ playing: !params.has('hold'), speed: RATES[1].speed, ...(t >= 420 && t <= 1140 ? { t } : {}) });
      return;
    }
    // straight from a decision: start at that moment, fly into the zone and let the minutes run slowly
    useSim.setState({ t: SCENES[applied].t, playing: true, speed: RATES[0].speed });
    setLayer('temp');
    const id = window.setTimeout(() => setScope('zone'), 650);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied]);

  const next = () => {
    if (applied === null) return;
    if (applied + 1 >= SCENES.length) {
      navigate('/impact');
      return;
    }
    useCycle.setState({ scene: applied + 1 });
    navigate('/agents');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && applied !== null) next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="page twin">
      <LightStage>
        <Building layer={layer} focus={scope === 'zone'} tags={tags} />
        <OrbitControls makeDefault enablePan={false} enableDamping dampingFactor={0.08} minDistance={24} maxDistance={520} minPolarAngle={0.2} maxPolarAngle={1.46} />
        <Rig shot={scope === 'zone' ? INSIDE : WHOLE} inset={{ left: 360, right: 30, top: 30, bottom: 130 }} seconds={scope === 'zone' ? 2.2 : 1.7} />
        <IdleSway amount={0.07} period={30} />
      </LightStage>
      <Tags els={tags} scope={scope} layer={layer} />

      <div className="twin-top">
        <div className="seg">
          <button aria-pressed={scope === 'building'} onClick={() => setScope('building')}>
            Whole building
          </button>
          <button aria-pressed={scope === 'zone'} onClick={() => setScope('zone')}>
            Open level 3
          </button>
        </div>
        <div className="seg">
          {LAYERS.map((l) => (
            <button key={l.id} aria-pressed={layer === l.id} onClick={() => setLayer(l.id)}>
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {scope === 'building' ? <Whole /> : <Inside applied={applied} onNext={next} />}
      <Legend layer={layer} />
      <TimeBar />
    </div>
  );
}
