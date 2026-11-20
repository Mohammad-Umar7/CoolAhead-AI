import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { create } from 'zustand';
import { COMFORT_HI, MODES, ROOMS, ZONE, fmtTime } from '../engine/config';
import type { Decision, Mode } from '../engine/types';
import { ROOM_CLIP, emptyClip } from '../data/footage';
import { MODE_LABEL } from '../lib/day';
import { DAY } from '../state/sim';
import Feed, { found, useTracks } from '../loop/Feed';
import { AGENTS, CUE, FEEDS, OUTREACH, SCENES, TALK, answered, asked, currentDecision, ease, endOf, hasArrived, phaseAt, progress, roomCheck, runCycle, sent, sub, talkAt, useCue, useCycle, useOnce, useProgress } from '../loop/cycle';
import { LIAISONS, liaisonFor, type Liaison } from '../loop/liaison';
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
/** under the specialists: the liaison agents, on call */
const LANE = { y: CARD.y + CARD.h + 12, h: 30 };
const CH = LANE.y + LANE.h;
const HUB = ORCH.x + ORCH.w / 2;
const CHECK = { camera: 'Cameras', occupied: 'Shared zone', comfort: 'Comfort', overcool: 'Overcooling', air: 'Fresh air', dwell: 'Run time' } as const;
const BUSY = ['', 'Reading the timetable and the camera counts.', 'Trying each plan on a thermal model of the zone.', 'Holding the plan against six hard rules.'];
const RANK: Record<Mode, number> = { OFF: 0, STANDBY: 0, REDUCED: 1, NORMAL: 2, PRECOOL: 3 };
/** The camera tile above the recommendation: when a department has to be told, it turns over into that conversation. */
const DESK = 2;

if (import.meta.env.DEV) (window as unknown as { __cycle: typeof useCycle }).__cycle = useCycle;

const stateOf = (p: number) => (p < 0 ? 'wait' : p < 1 ? 'work' : 'done');

/**
 * True when the page has been opened again on a decision that was already under way or finished. What is
 * already part of the picture is then simply there, without its entrance; only what arrives later animates.
 */
const Back = createContext(false);
/** Whether a part that is `here` should skip its entrance: it was already here when the page was opened again. */
function useStill(here: boolean) {
  const back = useContext(Back);
  const [still, setStill] = useState(back && here);
  useEffect(() => {
    if (!here) setStill(false);
  }, [here]);
  return still;
}
/** How far the detector's sweep has crossed a room's picture while that room is being checked. */
const sweep = (room: number, time: number) => ease(sub(roomCheck(room, time), 0.24, 0.9));

/** The running count: what each camera has found so far in this decision. */
const useTally = create<{ rooms: number[] }>(() => ({ rooms: [0, 0, 0] }));

/* ---------------------------------------------------------------- vision: one camera per room, checked one at a time */

function Room({ room, d, turns }: { room: number; d: Decision; turns: boolean }) {
  const spec = ROOMS[room];
  const away = useCycle((s) => turns && s.time >= TALK.turn);
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
    <div className={`room ${stage}${away ? ' turned' : ''}`} style={{ left: X[room], width: COL, height: VIDEO_H }}>
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

/* ---------------------------------------------------------------- the outer loop: a liaison agent talks to a department */

/**
 * The conversation a liaison agent has with its department, once the
 * recommendation is out. It takes the place of one camera tile, in the column
 * where CoolAhead speaks to people. The departments are simulated.
 */
function Desk({ talk }: { talk: Liaison }) {
  // redrawn only when the tile turns, a line lands or the dots change
  useCycle((s) => {
    const k = talkAt(s.time);
    return `${k.turned ? 1 : 0}.${k.shown}.${k.typing}.${k.done ? 1 : 0}`;
  });
  const k = talkAt(useCycle.getState().time);
  // lines that were already said when the page was opened again do not pop in a second time
  const back = useContext(Back);
  const [said, setSaid] = useState(back ? k.shown : 0);
  useEffect(() => {
    if (k.shown < said) setSaid(0);
  }, [k.shown, said]);
  const mark = <i className="desk-mark">{talk.mark}</i>;
  return (
    <section className={`desk${k.turned ? ' in' : ''}`} style={{ left: X[DESK], width: COL, height: VIDEO_H }} aria-hidden={!k.turned}>
      <header className="desk-head">
        <span className="desk-agent">
          <i />
          {talk.agent}
        </span>
        <svg viewBox="0 0 20 12" width="18" height="11" aria-hidden="true">
          <path d="M1.5 3.5h13m-2.6-2.6 2.6 2.6-2.6 2.6M18.5 8.5h-13m2.6 2.6-2.6-2.6 2.6-2.6" />
        </svg>
        <span className="desk-dept">
          {mark}
          {talk.dept}
        </span>
        <em className="mono">simulated</em>
      </header>
      <div className="desk-log">
        {talk.lines.slice(0, k.shown).map((l, i) => (
          <p key={i} className={`say ${l.who === 'agent' ? 'mine' : 'theirs'}${i < said ? ' still' : ''}`}>
            {l.who === 'dept' && mark}
            <span>{l.text}</span>
          </p>
        ))}
        {k.typing >= 0 && (
          <p key="dots" className={`say ${talk.lines[k.typing].who === 'agent' ? 'mine' : 'theirs'} dots`}>
            {talk.lines[k.typing].who === 'dept' && mark}
            <span>
              <b />
              <b />
              <b />
            </span>
          </p>
        )}
        <p className={`desk-done${k.done ? ' in' : ''}`}>
          <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
            <path d="m2.6 6.3 2.3 2.3 4.6-5" />
          </svg>
          {talk.outcome}
        </p>
      </div>
    </section>
  );
}

/**
 * The liaison agents, always in sight under the specialists: on call until a
 * situation needs one of them, lit while it talks, and showing what it settled.
 */
function Roster({ talk }: { talk: Liaison | null }) {
  const here = useOnce(CUE.verdict);
  const stage = useCycle((s) => {
    if (!talk) return '';
    const k = talkAt(s.time);
    return !k.called ? '' : k.done ? 'done' : 'live';
  });
  return (
    <div className={`roster${here ? '' : ' hid'}`} style={{ left: ORCH.x, top: LANE.y, width: ORCH.w, height: LANE.h }}>
      <span className="roster-k mono">On call</span>
      {LIAISONS.map((a) => {
        const mine = talk?.id === a.id ? stage : '';
        return (
          <span key={a.id} className={`roster-pill${mine ? ` ${mine}` : ''}`}>
            <i />
            <b>{a.agent}</b>
            {mine === 'done' ? (
              <em>{talk!.outcome}</em>
            ) : (
              <>
                <svg viewBox="0 0 12 10" width="11" height="9" aria-hidden="true">
                  <path d="M1 5h9.4M7.2 1.8 10.4 5 7.2 8.2" />
                </svg>
                {a.dept}
              </>
            )}
          </span>
        );
      })}
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
  const scene = useCycle((s) => s.scene);
  const ph = phaseAt(time);
  // the same line that reached the camera carries the call to the liaison agent, and the outcome back
  const talk = OUTREACH.has(SCENES[scene].id) ? talkAt(time) : null;
  // where the department's answer changes the next hour, the orchestrator passes it down to Forecast
  const feeds = FEEDS.has(SCENES[scene].id);
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
          <path className={`wire${r === DESK && talk?.called && !talk.reported ? ' live' : tone(0, checking < 0 || checking === r)}`} d={line(pts)} pathLength={1} />
          {message(line(pts), 0)}
          {r === DESK && talk?.called && talk.out < 1 && <Comet d={line(pts)} u={ease(talk.out)} back={false} />}
          {r === DESK && talk?.done && talk.back < 1 && <Comet d={line(pts)} u={ease(talk.back)} back />}
        </g>
      ))}
      {TO_CARD.map((pts, i) => (
        <g key={i} className={`strand${seen([CUE.forecast, CUE.optimizer, CUE.safety][i]) ? ' in' : ''}`}>
          <path className={`wire${tone(i + 1)}`} d={line(pts)} pathLength={1} />
          {message(line(pts), i + 1)}
          {i === 0 && feeds && talk?.reported && talk.fed < 1 && <Comet d={line(pts)} u={ease(talk.fed)} back={false} />}
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

function Orchestrator({ d, talk }: { d: Decision; talk: Liaison | null }) {
  const ph = useCycle((s) => phaseAt(s.time));
  // after the recommendation: calling a liaison agent, waiting while it talks, hearing what came back
  const outer = useCycle((s) => {
    if (!talk) return '';
    const k = talkAt(s.time);
    if (!k.called) return '';
    if (k.reported) return s.time >= endOf(s.scene) ? 'told' : 'report';
    return k.shown > 0 || k.typing >= 0 ? 'talk' : 'call';
  });
  const room = useCycle((s) => {
    const p = progress(0, s.time);
    return p >= 0 && p < 1 ? Math.min(2, Math.floor(p * 3)) : -1;
  });
  const solo = useCycle((s) => s.first && s.time < CUE.rail);
  const back = useContext(Back);
  const lines = useMemo(() => script(d), [d]);
  const name = ph.agent >= 0 && ph.agent < 4 ? AGENTS[ph.agent].name : '';

  let route: ReactNode = null;
  let text = '';
  if (talk && outer === 'call') {
    route = (
      <>
        calls <b>{talk.agent}</b>
      </>
    );
    text = talk.why;
  } else if (talk && outer === 'talk') {
    route = (
      <>
        <b>{talk.agent}</b> is talking to
      </>
    );
    text = `the ${talk.dept.charAt(0).toLowerCase()}${talk.dept.slice(1)}.`;
  } else if (talk && outer) {
    route = <em>{talk.agent} reports</em>;
    text = talk.report;
  } else if (ph.kind === 'boot') text = `New decision for zone ${ZONE.id}. It is ${fmtTime(d.t)}.`;
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

  const saying = `${d.t}-${ph.kind}-${ph.agent}-${ph.kind === 'work' && ph.agent === 0 ? room : ''}-${outer === 'told' ? 'report' : outer}`;
  // the sentence that was on the bar when the page was opened again is not written out a second time
  const first = useRef(saying);
  const quiet = back && saying === first.current;

  return (
    <div className={`orch is-${outer === 'told' ? 'told' : outer ? 'talk' : ph.kind}${solo ? ' solo' : ''}${back ? ' still' : ''}`} style={{ left: ORCH.x, top: ORCH.y, width: ORCH.w, height: ORCH.h }}>
      <div className="orch-id">
        <i />
        <strong>Orchestrator</strong>
      </div>
      <p className={`orch-say${quiet ? ' still' : ''}`} key={saying}>
        {route && <span className="orch-route">{route}</span>}
        <Words text={text} />
      </p>
    </div>
  );
}

/** What a slot of the next hour is called once a department has explained it. */
const EXPLAINED: Record<string, string> = { noshow: 'cancelled', unlisted: 'guest talk' };

function Forecast({ d, talk }: { d: Decision; talk: Liaison | null }) {
  const p = useProgress(1);
  const here = useCue(CUE.forecast);
  const word = useMemo(() => forecastWord(d), [d]);
  const draw = p < 0 ? 0 : ease(sub(p, 0.05, 0.75));
  // a department's answer, passed on by the orchestrator, replaces the guess
  const told = useCycle((s) => !!talk?.forecast && talkAt(s.time).told);
  const still = useStill(here);
  const toldStill = useStill(told);
  return (
    <section className={`agent ${stateOf(p)} ${here ? 'in' : 'out'}${told ? ' told' : ''}${still ? ' still' : ''}`} style={{ left: CARD.x[0], top: CARD.y, width: CARD.w, height: CARD.h }}>
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
                  {s.to - s.from >= 18 ? (told && EXPLAINED[s.kind]) || s.label : ''}
                </b>
              ))}
            </i>
          </div>
        ))}
      </div>
      <p key={told ? 'told' : 'own'} className={`agent-say${told ? ' good told' : word.flag ? ' flag' : ''}${p >= 0.8 ? ' in' : ''}${toldStill ? ' still' : ''}`}>
        {told ? talk!.forecast : word.text}
      </p>
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
  const still = useStill(here);
  return (
    <section className={`agent ${stateOf(p)} ${here ? 'in' : 'out'}${still ? ' still' : ''}`} style={{ left: CARD.x[1], top: CARD.y, width: CARD.w, height: CARD.h }}>
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
  const still = useStill(here);
  return (
    <section className={`agent ${stateOf(p)} ${here ? 'in' : 'out'}${still ? ' still' : ''}`} style={{ left: CARD.x[2], top: CARD.y, width: CARD.w, height: CARD.h }}>
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
  // read before `arrive` runs: the page is being opened again on a decision that has already been shown
  const [back] = useState(() => hasArrived() && useCycle.getState().time > 0);
  const title = useRef(useCycle.getState().decision);
  const navigate = useNavigate();
  const d = currentDecision(index);
  const talk = useMemo(() => liaisonFor(SCENES[scene], d), [scene, d]);

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
    <Back.Provider value={back}>
    <div className={`page loop${leaving ? ' leaving' : ''}${back ? ' back' : ''}`}>
      <header className="loop-head" style={{ width: CW }}>
        <div>
          <p className="loop-when">
            Situation {scene + 1} of {SCENES.length}
            <i />
            {fmtTime(d.t)}
          </p>
          <h1 key={d.t} className={back && index === title.current ? 'still' : undefined}>
            {SCENES[scene].title}
          </h1>
        </div>
        <div className={controls ? '' : 'hid'}>
          <Transport />
        </div>
      </header>

      <section className="loop-canvas" style={{ width: CW, height: CH }}>
        <Wires />
        {ROOMS.map((_, room) => (
          <Room key={room} room={room} d={d} turns={!!talk && room === DESK} />
        ))}
        {talk && <Desk key={talk.id} talk={talk} />}
        <Rail d={d} />
        <Orchestrator d={d} talk={talk} />
        <Forecast d={d} talk={talk} />
        <Optimizer d={d} />
        <Safety d={d} />
        <Verdict d={d} index={index} />
        <Roster talk={talk} />
      </section>

      <footer className={`loop-foot${controls ? '' : ' hid'}`} style={{ width: CW }}>
        <div className="scenes" role="group" aria-label="Situations of the test day">
          {SCENES.map((s, i) => (
            <button key={s.id} className={i === scene ? 'on' : ''} onClick={() => useCycle.getState().go(i)} title={OUTREACH.has(s.id) ? 'A liaison agent talks to a department in this one' : undefined}>
              <b>{i + 1}</b>
              {s.flag}
              {OUTREACH.has(s.id) && (
                <svg className="chip-talk" viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">
                  <path d="M2 3.2h10v6.2H6.4L3.8 11.8V9.4H2z" />
                </svg>
              )}
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
    </Back.Provider>
  );
}
