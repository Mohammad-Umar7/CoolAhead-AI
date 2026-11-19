import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { COMFORT_HI, COMFORT_LO, MODES, T0, VIEW_START } from '../engine/config';
import { runOf, type Source } from '../lib/frame';
import { derived } from '../lib/stats';
import type { AnchorEls } from '../scenes/Anchors';
import Stage, { Framing } from '../scenes/Stage';
import FloorScene from '../scenes/floor/FloorScene';
import { at, stepAt, useMinute, useSim } from '../state/sim';
import { ComfortChart, EnergyChart, TradeoffChart, dayKwh, dayOut, timerLabel } from '../ui/CompareCharts';
import { ModeBadge } from '../ui/DecisionCard';
import Scrubber from '../ui/Scrubber';
import Tags from '../ui/Tags';
import { FloorLights } from './Twin';

interface Link {
  pos: THREE.Vector3;
  by: string | null;
  stamp: number;
}

interface Orbit {
  update: () => void;
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
}

/** Turning one model turns the other, so the two are always seen from the same side. */
function CameraLink({ link, id }: { link: React.RefObject<Link>; id: string }) {
  const controls = useThree((s) => s.controls) as unknown as Orbit | null;
  const camera = useThree((s) => s.camera);
  const seen = useRef(0);
  useEffect(() => {
    if (!controls) return;
    const start = () => {
      link.current.by = id;
    };
    const end = () => {
      if (link.current.by === id) link.current.by = null;
    };
    controls.addEventListener('start', start);
    controls.addEventListener('end', end);
    return () => {
      controls.removeEventListener('start', start);
      controls.removeEventListener('end', end);
    };
  }, [controls, id, link]);
  useFrame(() => {
    const l = link.current;
    if (!controls) return;
    if (l.by === id) {
      l.pos.copy(camera.position);
      l.stamp++;
    } else if (l.stamp !== seen.current && l.stamp > 0) {
      camera.position.copy(l.pos);
      controls.update();
      seen.current = l.stamp;
    }
  });
  return null;
}

function Kpis({ source }: { source: Source }) {
  const t = useSim((s) => Math.floor(s.t * 2) / 2);
  const run = runOf(source);
  const kwh = at(run.energy, t) - at(run.energy, VIEW_START);
  const out = derived(source).outMin[Math.floor(t) - T0] - derived(source).outMin[VIEW_START - T0];
  const mode = stepAt(run.mode, t);
  return (
    <div className="cmp-kpis">
      <div>
        <span className={`num${source === 'cool' ? ' gold' : ''}`}>{kwh.toFixed(1)}</span>
        <i>kWh</i>
        <em>used since 07:00</em>
      </div>
      <div>
        <span className={`num${out > 0 ? ' bad' : ''}`}>{Math.round(out)}</span>
        <i>min</i>
        <em>outside comfort</em>
      </div>
      <div className="cmp-mode">{source === 'cool' ? <ModeBadge mode={mode} size="sm" /> : <span className={`timer${mode === 'OFF' ? '' : ' on'}`}>{mode === 'OFF' ? 'Timer off' : 'Timer on'}</span>}</div>
    </div>
  );
}

function View({ source, id, link, title, sub }: { source: Source; id: string; link: React.RefObject<Link>; title: React.ReactNode; sub: string }) {
  const tags = useRef<AnchorEls>({});
  return (
    <div className={`cmp-view ${id}`}>
      <Stage camera={{ position: [-22, 30, 34], fov: 26 }} studio tilt={0.05} bloom={0.4}>
        <FloorLights />
        <FloorScene source={source} view="live" tags={tags} reflect={false} />
        <OrbitControls makeDefault enablePan={false} enableZoom={false} enableDamping dampingFactor={0.08} minPolarAngle={0.3} maxPolarAngle={1.3} />
        <Framing span={30} from={[-0.5, 0.66, 0.82]} target={[0, 0.9, 0.2]} inset={{ top: 44, bottom: 6, left: 258, right: 52 }} />
        <CameraLink link={link} id={id} />
      </Stage>
      <Tags els={tags} source={source} compact />
      <header className="cmp-title">
        <span className="label">{id === 'before' ? 'Before' : 'After'}</span>
        <h2>{title}</h2>
        <p>{sub}</p>
      </header>
      <Kpis source={source} />
    </div>
  );
}

function Saving({ baseline }: { baseline: Source }) {
  const minute = useMinute();
  const base = at(runOf(baseline).energy, minute) - at(runOf(baseline).energy, VIEW_START);
  const cool = at(runOf('cool').energy, minute) - at(runOf('cool').energy, VIEW_START);
  const pct = base > 3 ? (1 - cool / base) * 100 : 0;
  // early in the day a late-starting timer can be ahead: the coin says so rather than hiding it
  const behind = base > 3 && cool > base + 0.05;
  return (
    <div className={`cmp-saving${behind ? ' behind' : ''}`}>
      <span className="label">So far</span>
      <strong className="num">{base > 3 ? `${pct >= 0 ? '−' : '+'}${Math.abs(pct).toFixed(0)}%` : '0%'}</strong>
      <em>
        {base - cool >= 0 ? '−' : '+'}
        {Math.abs(base - cool).toFixed(1)} kWh
      </em>
    </div>
  );
}

export default function Compare() {
  const [baseline, setBaseline] = useState<Source>('fixed');
  const link = useRef<Link>({ pos: new THREE.Vector3(), by: null, stamp: 0 });
  const eBase = dayKwh(baseline);
  const eCool = dayKwh('cool');
  const outBase = dayOut(baseline);
  const outCool = dayOut('cool');

  return (
    <div className="compare">
      <header className="cmp-head">
        <div>
          <span className="label">Same day · same weather · same people · same building</span>
          <h1>
            The fixed timer against CoolAhead: <b>{(100 * (1 - eCool / eBase)).toFixed(0)}% less energy</b>
            {outBase > outCool + 0.5 ? `, ${Math.round(outBase - outCool)} fewer minutes outside comfort` : ', same comfort'}
          </h1>
        </div>
        <div className="seg" role="group" aria-label="Fixed schedule to compare with">
          <button aria-pressed={baseline === 'fixed'} onClick={() => setBaseline('fixed')} title="The timer covers the whole teaching day">
            Generous timer {timerLabel('fixed')}
          </button>
          <button aria-pressed={baseline === 'tight'} onClick={() => setBaseline('tight')} title="A shorter timer some sites use to save energy">
            Tight timer {timerLabel('tight')}
          </button>
        </div>
      </header>

      <section className="cmp-views">
        <View
          id="before"
          source={baseline}
          link={link}
          title={
            <>
              Fixed schedule,
              <br />
              {timerLabel(baseline)}
            </>
          }
          sub={`Full fan while the timer is on, one thermostat at ${MODES.TIMER.target} °C. Blind to who is in which room.`}
        />
        <Saving baseline={baseline} />
        <View id="after" source="cool" link={link} title="CoolAhead recommendations" sub="Head counts, the timetable and the shared-zone model pick the mode, minute by minute." />
      </section>

      <section className="cmp-charts">
        <figure className="panel">
          <figcaption>
            <span className="label">Energy through the day</span>
            <span className="cmp-key">
              <i className="base" />
              fixed
              <i className="cool" />
              CoolAhead
            </span>
          </figcaption>
          <EnergyChart baseline={baseline} />
        </figure>
        <figure className="panel">
          <figcaption>
            <span className="label">
              Comfort, {COMFORT_LO} to {COMFORT_HI} °C
            </span>
            <span className="cmp-key">
              <i className="bad" />
              outside the band
            </span>
          </figcaption>
          <ComfortChart baseline={baseline} />
        </figure>
        <figure className="panel">
          <figcaption>
            <span className="label">Whole day: energy against comfort</span>
          </figcaption>
          <TradeoffChart baseline={baseline} />
        </figure>
      </section>

      <footer className="cmp-foot">
        <Scrubber />
        <p className="cmp-fine">Modelled results for a simulated zone of three classrooms on one air handler. They are not measured savings for Liwa University.</p>
      </footer>
    </div>
  );
}
