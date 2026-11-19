import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AnchorEls } from '../scenes/Anchors';
import Stage from '../scenes/Stage';
import IntroScene, { BEAT, newIntroState, type IntroHud, type IntroState } from '../scenes/intro/IntroScene';
import { preloadSatellite } from '../scenes/intro/Satellite';

// the map starts downloading as soon as this page's code arrives
preloadSatellite();
import { Mark } from '../ui/TopBar';

export default function Intro() {
  const state = useRef<IntroState>(newIntroState());
  const labels = useRef<AnchorEls>({});
  const hud = useRef<IntroHud>({ alt: null, lat: null, lon: null, scale: null });
  const [stage, setStage] = useState<'map' | 'title' | 'leaving'>('map');
  const navigate = useNavigate();
  // lets a test scrub the sequence: window.__intro.time = 4
  if (import.meta.env.DEV) (window as unknown as { __intro: IntroState }).__intro = state.current;

  useEffect(() => {
    const id = window.setInterval(() => {
      if (state.current.time >= BEAT.title) setStage((s) => (s === 'map' ? 'title' : s));
    }, 100);
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
      else enter('/agents');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pin = (key: string) => (el: HTMLDivElement | null) => {
    labels.current[key] = el;
  };

  return (
    <div className={`intro is-${stage}`}>
      <Stage camera={{ position: [0, 16000, 0], fov: 34, near: 100, far: 4e5 }} bloom={0} plain="#f3f1ea">
        <IntroScene state={state} labels={labels} hud={hud} />
      </Stage>

      <div className="intro-labels" aria-hidden="true">
        <div className="map-pin" ref={pin('campus')}>
          <span className="map-tag">
            <i />
            <b>Liwa University</b>
            Abu Dhabi campus
          </span>
        </div>
        <div className="map-pin" ref={pin('roof')}>
          <span className="map-tag up">
            <i />
            <b>Liwa University</b>
            12 storeys
          </span>
        </div>
        <div className="map-pin" ref={pin('zone')}>
          <span className="map-tag zone">
            <i />
            <b>Level 3 · Zone AHU-3A</b>
            three classrooms, one air handler
          </span>
        </div>
      </div>

      <header className="intro-head">
        <div className="intro-brand">
          <Mark />
          <span>
            CoolAhead<i>AI</i>
          </span>
        </div>
        <span className="intro-event mono">Liwa University · Smart Campus Hackathon</span>
        <button className="intro-skip mono" onClick={skip}>
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
          <span ref={(el) => void (hud.current.alt = el)}>16 km</span>
        </div>
        <div className="intro-scale">
          <i />
          <span ref={(el) => void (hud.current.scale = el)}>2 km</span>
        </div>
      </div>

      <section className="intro-title">
        <p className="intro-kicker mono">
          <i />
          Privacy-aware predictive cooling
        </p>
        <h1>
          <span className="ti-sans">Cool</span>
          <em>Ahead</em>
          <sup className="ti-ai">AI</sup>
        </h1>
        <p className="intro-lede">
          One air handler often cools several classrooms at once. CoolAhead <strong>counts the people in each room</strong> without recognising anyone, <strong>reads the timetable</strong>, and tells the
          facilities team how the whole zone should run: <strong>before the lecture, not after the room is already warm.</strong>
        </p>
        <div className="intro-cta">
          <button className="intro-go" onClick={() => enter('/agents')}>
            Watch the agents decide
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
              <path d="M2 8h11M9 3.5 13.5 8 9 12.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="intro-key mono">or press Enter</span>
        </div>
        <div className="intro-team">
          <p>
            Mohammad Umar <i>·</i> Bilal Feroz <i>·</i> Aamir Koily
          </p>
          <span className="mono">Supervisor · Zaid Hadya</span>
        </div>
        <p className="intro-fine">
          Software-only proof of concept on a simulated zone. Results are modelled, not measured at Liwa University. Imagery © Esri, Maxar, Earthstar Geographics. Footprint © OpenStreetMap contributors.
        </p>
      </section>
      <div className="intro-veil" />
    </div>
  );
}
