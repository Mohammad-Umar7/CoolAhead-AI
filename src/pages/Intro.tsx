import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { AnchorEls } from '../scenes/Anchors';
import Stage from '../scenes/Stage';
import IntroScene, { BEAT, newIntroState, type IntroHud, type IntroState } from '../scenes/intro/IntroScene';
import { Mark } from '../ui/TopBar';

const PLACES = ['Abu Dhabi', 'Dubai', 'Sharjah', 'Al Ain', 'Ras Al Khaimah', 'Fujairah', 'Liwa Oasis'];

export default function Intro() {
  const state = useRef<IntroState>(newIntroState());
  const labels = useRef<AnchorEls>({});
  const hud = useRef<IntroHud>({ alt: null, lat: null, lon: null, scale: null });
  const [stage, setStage] = useState<'map' | 'title' | 'leaving'>('map');
  const navigate = useNavigate();
  // lets a test scrub the sequence: window.__intro.time = 9
  if (import.meta.env.DEV) (window as unknown as { __intro: IntroState }).__intro = state.current;

  useEffect(() => {
    const id = window.setInterval(() => {
      if (state.current.time >= BEAT.title) setStage((s) => (s === 'map' ? 'title' : s));
    }, 120);
    return () => window.clearInterval(id);
  }, []);

  const skip = () => {
    state.current.skip = true;
  };
  const enter = (to: string) => {
    if (stage === 'leaving') return;
    state.current.skip = true;
    state.current.enter = 0.001;
    setStage('leaving');
    window.setTimeout(() => navigate(to), 1250);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      if (state.current.time < BEAT.title) skip();
      else enter('/twin');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pin = (key: string) => (el: HTMLDivElement | null) => {
    labels.current[key] = el;
  };

  return (
    <div className={`intro is-${stage}`}>
      <Stage camera={{ position: [0, 760000, 0], fov: 34, near: 1000, far: 4e7 }} bloom={0.85}>
        <IntroScene state={state} labels={labels} hud={hud} />
      </Stage>

      <div className="intro-labels" aria-hidden="true">
        <div className="map-pin" ref={pin('uae')}>
          <span className="map-country">United Arab Emirates</span>
        </div>
        {PLACES.map((p) => (
          <div key={p} className="map-pin" ref={pin(`place:${p}`)}>
            <span className={`map-place${p === 'Liwa Oasis' ? ' faint' : ''}`}>{p}</span>
          </div>
        ))}
        <div className="map-pin" ref={pin('campus')}>
          <span className="map-campus">
            <b>Liwa University</b>
            Abu Dhabi campus
          </span>
        </div>
        <div className="map-pin" ref={pin('roof')}>
          <span className="map-campus up">
            <b>Liwa University</b>
            Abu Dhabi campus · 12 storeys
          </span>
        </div>
        <div className="map-pin" ref={pin('zone')}>
          <span className="map-zone">
            <b>Level 3 · Zone AHU-3A</b>
            three classrooms, one air handler
          </span>
        </div>
      </div>

      <header className="intro-head">
        <div className="brand">
          <Mark />
          <span className="brand-name">
            CoolAhead<i>AI</i>
          </span>
        </div>
        <span className="label">Liwa University · Smart Campus Hackathon</span>
        <button className="intro-skip label" onClick={skip}>
          Skip intro
        </button>
      </header>

      <div className="intro-readout mono">
        <div>
          <span ref={(el) => void (hud.current.lat = el)}>24.4855° N</span>
          <span ref={(el) => void (hud.current.lon = el)}>54.3756° E</span>
        </div>
        <div>
          <b>ALT</b>
          <span ref={(el) => void (hud.current.alt = el)}>760 km</span>
        </div>
        <div className="intro-scale">
          <i />
          <span ref={(el) => void (hud.current.scale = el)}>100 km</span>
        </div>
      </div>

      <section className="intro-title">
        <p className="label">Privacy-aware predictive cooling for shared AC zones</p>
        <h1 className="display">
          Cool<em>Ahead</em> AI
        </h1>
        <p className="intro-lede">
          One air handler often serves several classrooms. CoolAhead counts people without recognising anyone, reads the timetable, and recommends how the whole zone should run: ahead of the
          lecture, not after the room is already warm.
        </p>
        <div className="intro-cta">
          <button className="btn primary" onClick={() => enter('/twin')}>
            Enter the twin
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M2 8h11M9 3.5 13.5 8 9 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <Link className="btn" to="/agents">
            How the agents decide
          </Link>
        </div>
        <p className="intro-team">
          Mohammad Umar · Bilal Feroz · Aamir Koily
          <span>Supervisor: Zaid Hadya</span>
        </p>
        <p className="intro-fine">
          Software-only proof of concept on a simulated zone. Results are modelled, not measured at Liwa University. Map data © OpenStreetMap contributors, Natural Earth.
        </p>
      </section>
      <div className="intro-veil" />
    </div>
  );
}
