import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { create } from 'zustand';
import { COMFORT_HI, MODES, ROOMS, ZONE, fmtTime } from '../engine/config';
import type { Decision, Mode } from '../engine/types';
import { ROOM_CLIP, emptyClip } from '../data/footage';
import { MODE_LABEL } from '../lib/day';
import { DAY } from '../state/sim';
import Feed, { found, useTracks } from '../loop/Feed';
import { AGENTS, CUE, SCENES, answered, asked, currentDecision, ease, phaseAt, progress, roomCheck, runCycle, sent, sub, useCue, useCycle, useOnce, useProgress } from '../loop/cycle';
import { forecastWord, nextHour, plans, saving, script } from '../loop/story';

/**
 * The page is one picture that builds itself. The orchestrator starts alone;
 * each camera, each specialist and finally the recommendation appear at the
 * moment the orchestrator calls for them. It is drawn on a fixed canvas so the
 * lines the messages travel on can be placed exactly.
 */
const CW = 1376;
const COL = 432;
const X = [0, 472, 944];
const VIDEO_H = 262;
const RAIL_Y = 283;
const ORCH = { x: 0, y: 304, w: 904, h: 60 };
const CARD = { y: 398, h: 158, w: 284, x: [0, 310, 620] };
const OUT = { x: 944, y: 304, w: 432, h: CARD.y + CARD.h - 304 };
const CH = CARD.y + CARD.h;
const HUB = ORCH.x + ORCH.w / 2;
const CHECK = { camera: 'Cameras', occupied: 'Shared zone', comfort: 'Comfort', overcool: 'Overcooling', air: 'Fresh air', dwell: 'Run time' } as const;
const BUSY = ['', 'Reading the timetable and the camera counts.', 'Trying each plan on a thermal model of the zone.', 'Holding the plan against six hard rules.'];
const RANK: Record<Mode, number> = { OFF: 0, STANDBY: 0, REDUCED: 1, NORMAL: 2, PRECOOL: 3 };

if (import.meta.env.DEV) (window as unknown as { __cycle: typeof useCycle }).__cycle = useCycle;

const stateOf = (p: number) => (p < 0 ? 'wait' : p < 1 ? 'work' : 'done');
/** How far the detector's sweep has crossed a room's picture while that room is being checked. */
const sweep = (room: number, time: number) => ease(sub(roomCheck(room, time), 0.24, 0.9));

/** The running count: what each camera has found so far in this decision. */
const useTally = create<{ rooms: number[] }>(() => ({ rooms: [0, 0, 0] }));

/* ---------------------------------------------------------------- vision: one camera per room, checked one at a time */

function Room({ room, d }: { room: number; d: Decision }) {
  const spec = ROOMS[room];
  const online = d.vision.online[room];
  const count = online ? (d.vision.count[room] ?? 0) : 0;
  const clip = !online ? null : count >= 1 ? ROOM_CLIP[room] : emptyClip(room);
  const tracks = useTracks(count >= 1 ? clip : null);
  const stage = useCycle((s) => {
    const q = roomCheck(room, s.time);
    return q < 0 ? 'off' : q < 1 ? 'checking' : 'on';
  });
  const shown = useCycle((s) => found(tracks, count, sweep(room, s.time)));
  useEffect(() => {
    useTally.setState((t) => ({ rooms: t.rooms.map((v, i) => (i === room ? (stage === 'off' ? 0 : shown) : v)) }));
  }, [room, shown, stage]);
  return (
    <div className={`room ${stage}`} style={{ left: X[room], width: COL, height: VIDEO_H }}>
      <Feed clip={clip} tracks={tracks} count={count} online={online} reveal={() => sweep(room, useCycle.getState().time)} />
      <span className="room-name mono">
        CAM-0{room + 1}
        <b>{spec.id}</b>
        {spec.name}
      </span>
      <span className={`room-rec mono${online ? '' : ' down'}`}>
        <i />
        {online ? 'Live' : 'Offline'}
      </span>
      <span className={`room-count${online ? '' : ' down'}`}>
        <strong className="num">{online ? shown : '?'}</strong>
        {online ? (shown === 1 ? 'person' : 'people') : 'camera down'}
      </span>
      {online && (
        <span className="room-safe mono">
          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
            <path d="M3.2 5.4V4a2.8 2.8 0 0 1 5.6 0v1.4M2.4 5.4h7.2v4.8H2.4z" />
          </svg>
          on-device
        </span>
      )}
    </div>
  );
}

/** What stands on the line between the cameras and the orchestrator: who is looking, how many they found, and where the video goes (nowhere). */
function Rail({ d }: { d: Decision }) {
  const rooms = useTally((t) => t.rooms);
  const here = useCue(CUE.rail);
  const busy = useCycle((s) => {
    const ph = phaseAt(s.time);
    return ph.agent === 0 && ph.kind !== 'boot';
  });
  const lost = d.vision.online.some((o) => !o);
  const total = rooms.reduce((a, b) => a + b, 0);
  return (
    <div className={`rail${here ? '' : ' hid'}`} style={{ top: RAIL_Y, width: CW }}>
      <span className={`rail-pill${busy ? ' on' : ''}`} style={{ left: cx(0) }}>
        <b>Vision</b> YOLO person detector
      </span>
      <span className="rail-pill tally" style={{ left: cx(1) }}>
        <strong className="num">{total}</strong>
        {total === 1 ? 'person' : 'people'} in the zone{lost ? ', one room unknown' : ''}
      </span>
      <span className="rail-pill safe" style={{ left: cx(2) }}>
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <path d="M3.2 5.4V4a2.8 2.8 0 0 1 5.6 0v1.4M2.4 5.4h7.2v4.8H2.4z" />
        </svg>
        Video stays on the camera. Only the count is sent.
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- the lines the messages travel on */

const cx = (room: number) => X[room] + COL / 2;
type Pt = [number, number];

/** From the orchestrator up to each camera, and down to each specialist. */
const TO_ROOM: Pt[][] = ROOMS.map((_, r) => [
  [HUB, ORCH.y],
  [HUB, RAIL_Y],
  [cx(r), RAIL_Y],
  [cx(r), VIDEO_H + 3],
]);
const TO_CARD: Pt[][] = CARD.x.map((x) => [
  [x + CARD.w / 2, ORCH.y + ORCH.h],
  [x + CARD.w / 2, CARD.y],
]);
const line = (pts: Pt[]) => `M${pts.map((p) => p.join(' ')).join('L')}`;
const TAIL = 0.3;

/** A message on its way along a line: a bright head with a fading tail. `u` runs 0..1 from the orchestrator outwards. */
function Comet({ d, u, back }: { d: string; u: number; back: boolean }) {
  // the dash is laid from the far end when the message is coming back
  const at = back ? 1 - u : u;
  return <path className={`comet${back ? ' back' : ''}`} d={d} pathLength={1} strokeDasharray={`${TAIL} 2`} strokeDashoffset={back ? -(1 - at) : TAIL - at * (1 + TAIL)} />;
}

function Wires() {
  const time = useCycle((s) => s.time);
  const ph = phaseAt(time);
  const seen = (at: number) => time >= at;
  const checking = ph.kind === 'work' && ph.agent === 0 ? Math.min(2, Math.floor(progress(0, time) * 3)) : -1;

  const message = (d: string, agent: number) => {
    if (ph.agent !== agent) return null;
    if (ph.kind === 'ask') return <Comet d={d} u={ease(asked(agent, time))} back={false} />;
    if (ph.kind === 'answer') return <Comet d={d} u={ease(answered(agent, time))} back />;
    return null;
  };
  const tone = (agent: number, on = true) => (ph.agent === agent && on && ph.kind !== 'rest' ? ' live' : progress(agent, time) >= 1 ? ' done' : '');
  const go = ease(sent(time));
  const y = ORCH.y + ORCH.h / 2;
  const out = `M${ORCH.x + ORCH.w} ${y}H${OUT.x - 9}`;

  return (
    <svg className="wires" width={CW} height={CH} aria-hidden="true">
      {TO_ROOM.map((pts, r) => (
        <g key={r} className={`strand${seen(CUE.rail) ? ' in' : ''}`}>
          <path className={`wire${tone(0, checking < 0 || checking === r)}`} d={line(pts)} pathLength={1} />
          {message(line(pts), 0)}
        </g>
      ))}
      {TO_CARD.map((pts, i) => (
        <g key={i} className={`strand${seen([CUE.forecast, CUE.optimizer, CUE.safety][i]) ? ' in' : ''}`}>
          <path className={`wire${tone(i + 1)}`} d={line(pts)} pathLength={1} />
          {message(line(pts), i + 1)}
        </g>
      ))}
      <g className={`strand${seen(CUE.verdict) ? ' in' : ''}`}>
        <path className={`wire${go > 0 ? ' live' : ''}`} d={out} pathLength={1} />
        <path className={`wire-tip${go >= 1 ? ' live' : ''}`} d={`M${OUT.x - 14} ${y - 6}l7 6-7 6`} />
        {go > 0 && go < 1 && <Comet d={out} u={go} back={false} />}
      </g>
    </svg>
  );
}

/* ---------------------------------------------------------------- the orchestrator and its three specialists */

/** A sentence that arrives word by word. */
function Words({ text }: { text: string }) {
  return (
    <>
      {text.split(' ').map((w, i) => (
        <span key={i} className="word" style={{ animationDelay: `${i * 24}ms` }}>
          {w}{' '}
        </span>
      ))}
    </>
  );
}

function Orchestrator({ d }: { d: Decision }) {
  const ph = useCycle((s) => phaseAt(s.time));
  const room = useCycle((s) => {
    const p = progress(0, s.time);
    return p >= 0 && p < 1 ? Math.min(2, Math.floor(p * 3)) : -1;
  });
  const solo = useCycle((s) => s.first && s.time < CUE.rail);
  const lines = useMemo(() => script(d), [d]);
  const name = ph.agent >= 0 && ph.agent < 4 ? AGENTS[ph.agent].name : '';

  let route: ReactNode = null;
  let text = '';
  if (ph.kind === 'boot') text = `New decision for zone ${ZONE.id}. It is ${fmtTime(d.t)}.`;
  else if (ph.kind === 'ask') {
    route = (
      <>
        asks <b>{name}</b>
      </>
    );
    text = lines.ask[ph.agent];
  } else if (ph.kind === 'work' && ph.agent === 0) {
    route = (
      <>
        <b>Vision</b> is checking
      </>
    );
    text = room >= 0 ? `${ROOMS[room].id}, the ${ROOMS[room].name.toLowerCase()}.` : '';
  } else if (ph.kind === 'work') {
    route = (
      <>
        <b>{name}</b> is working
      </>
    );
    text = BUSY[ph.agent];
  } else if (ph.kind === 'answer') {
    route = <em>{name} answers</em>;
    text = lines.answer[ph.agent];
  } else if (ph.kind === 'send' || ph.kind === 'show') {
    route = (
      <>
        tells <b>the facilities team</b>
      </>
    );
    text = lines.final;
  } else text = 'Done. It runs again in 5 minutes, or at once if a count jumps or a camera drops.';

  return (
    <div className={`orch is-${ph.kind}${solo ? ' solo' : ''}`} style={{ left: ORCH.x, top: ORCH.y, width: ORCH.w, height: ORCH.h }}>
      <div className="orch-id">
        <i />
        <strong>Orchestrator</strong>
      </div>
      <p className="orch-say" key={`${d.t}-${ph.kind}-${ph.agent}-${ph.kind === 'work' && ph.agent === 0 ? room : ''}`}>
        {route && <span className="orch-route">{route}</span>}
        <Words text={text} />
      </p>
    </div>
  );
}

function Forecast({ d }: { d: Decision }) {
  const p = useProgress(1);
  const here = useCue(CUE.forecast);
  const word = useMemo(() => forecastWord(d), [d]);
  const draw = p < 0 ? 0 : ease(sub(p, 0.05, 0.75));
  return (
    <section className={`agent ${stateOf(p)} ${here ? 'in' : 'out'}`} style={{ left: CARD.x[0], top: CARD.y, width: CARD.w, height: CARD.h }}>
      <header>
        <h3>Forecast</h3>
        <span>timetable, next hour</span>
      </header>
      <div className="hour">
        {ROOMS.map((r, room) => (
          <div key={r.id} className="hour-row">
            <span>{r.id}</span>
            <i>
              {nextHour(room, d).map((s, k) => (
                <b key={k} className={`${s.kind}${draw * 60 >= s.from ? ' in' : ''}`} style={{ left: `${(s.from / 60) * 100}%`, width: `${((s.to - s.from) / 60) * 100}%` }}>
                  {s.to - s.from >= 18 ? s.label : ''}
                </b>
              ))}
            </i>
          </div>
        ))}
      </div>
      <p className={`agent-say${word.flag ? ' flag' : ''}${p >= 0.8 ? ' in' : ''}`}>{word.text}</p>
    </section>
  );
}

function Optimizer({ d }: { d: Decision }) {
  const p = useProgress(2, 60);
  const here = useCue(CUE.optimizer);
  const rows = useMemo(() => plans(d), [d]);
  const top = Math.max(0.5, ...rows.map((r) => r.c.energy));
  const judged = p >= 0.7;
  const settled = p >= 0.86;
  return (
    <section className={`agent ${stateOf(p)} ${here ? 'in' : 'out'}`} style={{ left: CARD.x[1], top: CARD.y, width: CARD.w, height: CARD.h }}>
      <header>
        <h3>Optimizer</h3>
        <span>energy, next hour</span>
      </header>
      <div className="plans">
        {rows.map((r, i) => {
          const run = p < 0 ? 0 : ease(sub(p, 0.03 + i * 0.13, 0.34 + i * 0.13));
          const state = !judged ? '' : r.chosen && settled ? ' chosen' : verdict(r.c) === 'not needed' ? ' more' : !r.c.comfortable ? ' bad' : settled ? ' more' : '';
          return (
            <div key={r.mode} className={`plan${state}`} data-mode={r.mode}>
              <span className="plan-name">{MODE_LABEL[r.mode]}</span>
              <span className="plan-bar">
                <i style={{ width: `${Math.max(2, (r.c.energy / top) * 100) * run}%` }} />
              </span>
              <span className="plan-note">{!judged ? '' : r.chosen && settled ? 'chosen' : verdict(r.c) || (settled ? 'costs more' : '')}</span>
            </div>
          );
        })}
      </div>
      <p className={`agent-say${settled ? ' in' : ''}`}>Cheapest that works: {MODE_LABEL[d.safety.proposed].toLowerCase()}</p>
    </section>
  );
}

function Safety({ d }: { d: Decision }) {
  const p = useProgress(3);
  const here = useCue(CUE.safety);
  const s = d.safety;
  const hit = s.checks.find((c) => c.status !== 'pass');
  return (
    <section className={`agent ${stateOf(p)} ${here ? 'in' : 'out'}`} style={{ left: CARD.x[2], top: CARD.y, width: CARD.w, height: CARD.h }}>
      <header>
        <h3>Safety</h3>
        <span>six hard rules</span>
      </header>
      <ul className="ticks">
        {s.checks.map((c, i) => (
          <li key={c.id} className={p >= 0.06 + i * 0.13 ? c.status : 'todo'} title={c.detail}>
            <i />
            {CHECK[c.id]}
          </li>
        ))}
      </ul>
      <p className={`agent-say${s.overridden || hit ? ' flag' : ' good'}${p >= 0.9 ? ' in' : ''}`}>{s.overridden ? `Overruled: ${MODE_LABEL[s.final].toLowerCase()}` : hit ? 'On guard: no step-down' : 'All clear'}</p>
    </section>
  );
}

/**
 * Why a plan lost, in two words. A plan that was never in the running (pre-cooling with nobody on the
 * way) is "not needed"; one that leaves an occupied room too cold is "too cold"; otherwise "too warm".
 */
function verdict(c: Decision['candidates'][number]): string {
  if (c.comfortable) return '';
  if (c.discomfort === 0) return 'not needed';
  if (c.peakRoom >= 0 && c.peak <= COMFORT_HI - 0.3) return 'too cold';
  return 'too warm';
}

/** Whether this decision turns the cooling up or down, against the last time the mode was different. */
function direction(index: number): { way: 'up' | 'down' | 'hold'; text: string } {
  const now = DAY.decisions[index].mode;
  for (let i = index - 1; i >= 0; i--) {
    const before = DAY.decisions[i].mode;
    if (before === now) continue;
    const up = RANK[now] > RANK[before];
    return { way: up ? 'up' : 'down', text: `${up ? 'Up' : 'Down'} from ${MODE_LABEL[before].toLowerCase()}` };
  }
  return { way: 'hold', text: 'No change' };
}

function Verdict({ d, index }: { d: Decision; index: number }) {
  const p = useProgress(4);
  const fan = Math.round(MODES[d.mode].fan * 100);
  const turn = useMemo(() => direction(index), [index]);
  return (
    <section className={`verdict ${stateOf(p)}`} data-mode={d.mode} style={{ left: OUT.x, top: OUT.y, width: OUT.w, height: OUT.h }}>
      <span className="verdict-k">
        <i className={turn.way}>
          <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
            <path d={turn.way === 'hold' ? 'M2.5 6h7' : 'M6 2.2v7.6M2.6 5.6 6 2.2l3.4 3.4'} />
          </svg>
        </i>
        {turn.text}
      </span>
      <h2>{MODES[d.mode].label}</h2>
      <p>{saving(d)}</p>
      <div className="verdict-fan">
        <span>Airflow</span>
        <i>
          <b style={{ width: `${p >= 0.3 ? fan : 0}%` }} />
        </i>
        <strong className="num">{fan}%</strong>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- page */

function Transport() {
  const playing = useCycle((s) => s.playing);
  const { step, toggle, enter } = useCycle.getState();
  return (
    <div className="transport">
      <button className="replay" onClick={enter} title="Play this decision again from the start">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M3 8a5 5 0 1 0 1.6-3.7M3 2.6v2.6h2.6" />
        </svg>
        Replay
      </button>
      <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous situation">
        <svg viewBox="0 0 16 16" width="14" height="14">
          <path d="M10 3 5 8l5 5" />
        </svg>
      </button>
      <button className="icon-btn big" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
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
      <button className="icon-btn" onClick={() => step(1)} aria-label="Next situation">
        <svg viewBox="0 0 16 16" width="14" height="14">
          <path d="m6 3 5 5-5 5" />
        </svg>
      </button>
    </div>
  );
}

export default function Agents() {
  const scene = useCycle((s) => s.scene);
  const index = useCycle((s) => s.decision);
  const controls = useOnce(CUE.foot);
  const [leaving, setLeaving] = useState(false);
  const navigate = useNavigate();
  const d = currentDecision(index);

  /** The decision is made: go and watch it run in the building. */
  const toBuilding = () => {
    setLeaving(true);
    window.setTimeout(() => navigate(`/twin?applied=${useCycle.getState().scene}`), 620);
  };

  useEffect(() => {
    // the first visit builds the picture from nothing; coming back from another page keeps it where it was left
    useCycle.getState().arrive();
    if (import.meta.env.DEV) {
      // for checking a moment of the sequence: #/agents?scene=2&at=20000
      const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
      if (q.has('scene')) useCycle.getState().go(Number(q.get('scene')));
      if (q.has('at')) useCycle.setState({ time: Number(q.get('at')), playing: false, first: !q.has('scene') });
    }
    // when a decision has played out the picture stays: Replay runs it again, the arrows move on
    const stop = runCycle(() => undefined);
    const onKey = (e: KeyboardEvent) => {
      const c = useCycle.getState();
      if (e.key === ' ') {
        e.preventDefault();
        c.toggle();
      } else if (e.key === 'ArrowRight') c.step(1);
      else if (e.key === 'ArrowLeft') c.step(-1);
      else if (e.key === 'r' || e.key === 'R') c.enter();
      else if (e.key === 'Enter') toBuilding();
      else if (e.key >= '1' && e.key <= String(SCENES.length)) c.go(Number(e.key) - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      stop();
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`page loop${leaving ? ' leaving' : ''}`}>
      <header className="loop-head" style={{ width: CW }}>
        <div>
          <p className="loop-when">
            Situation {scene + 1} of {SCENES.length}
            <i />
            {fmtTime(d.t)}
          </p>
          <h1 key={d.t}>{SCENES[scene].title}</h1>
        </div>
        <div className={controls ? '' : 'hid'}>
          <Transport />
        </div>
      </header>

      <section className="loop-canvas" style={{ width: CW, height: CH }}>
        <Wires />
        {ROOMS.map((_, room) => (
          <Room key={room} room={room} d={d} />
        ))}
        <Rail d={d} />
        <Orchestrator d={d} />
        <Forecast d={d} />
        <Optimizer d={d} />
        <Safety d={d} />
        <Verdict d={d} index={index} />
      </section>

      <footer className={`loop-foot${controls ? '' : ' hid'}`} style={{ width: CW }}>
        <div className="scenes" role="group" aria-label="Situations of the test day">
          {SCENES.map((s, i) => (
            <button key={s.id} className={i === scene ? 'on' : ''} onClick={() => useCycle.getState().go(i)}>
              <b>{i + 1}</b>
              {s.flag}
            </button>
          ))}
        </div>
        <button className="see-it" onClick={toBuilding}>
          See it in 3D
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M2 8h11M9 3.5 13.5 8 9 12.5" />
          </svg>
        </button>
      </footer>
    </div>
  );
}
