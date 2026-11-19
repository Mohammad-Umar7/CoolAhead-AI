import { useRef, useState } from 'react';
import { OrbitControls } from '@react-three/drei';
import { COMFORT_HI, COMFORT_LO } from '../engine/config';
import { TEMP_RANGE, cssRamp } from '../lib/color';
import { DAY, at, useMinute } from '../state/sim';
import type { AnchorEls } from '../scenes/Anchors';
import Stage, { Framing } from '../scenes/Stage';
import FloorScene, { type FloorView } from '../scenes/floor/FloorScene';
import DecisionCard from '../ui/DecisionCard';
import Tags from '../ui/Tags';
import Timeline, { ModeLegend } from '../ui/Timeline';

const VIEWS: { id: FloorView; label: string; hint: string }[] = [
  { id: 'live', label: 'Live', hint: 'People, air and room temperature together' },
  { id: 'heat', label: 'Heat map', hint: 'Where people are, from the camera counts' },
  { id: 'thermal', label: 'Thermal', hint: 'Room air temperature against the comfort band' },
  { id: 'xray', label: 'X-ray', hint: 'One air handler feeding three rooms' },
];

export function FloorLights() {
  return (
    <>
      <hemisphereLight args={['#d6edf9', '#0d141b', 1.3]} />
      <directionalLight position={[-16, 26, -12]} intensity={2.4} color="#f0f8ff" />
      <directionalLight position={[-8, 14, 30]} intensity={1.5} color="#bfe6ff" />
      <directionalLight position={[26, 10, 8]} intensity={0.6} color="#8fd8ff" />
      <fog attach="fog" args={['#04070a', 60, 150]} />
    </>
  );
}

/** Outdoor conditions: the heat the zone is working against. */
function Weather() {
  const minute = useMinute();
  const tOut = at(DAY.tOut, minute + 0.5);
  const sun = at(DAY.sun, minute + 0.5);
  return (
    <div className="weather">
      <span className="label">Outside</span>
      <span className="weather-temp num">
        {tOut.toFixed(1)}
        <i>°C</i>
      </span>
      <span className="weather-sun" title="Direct sun on the south-west glazing">
        <span className="label">Sun on glass</span>
        <span className="weather-bar">
          <i style={{ width: `${Math.round(sun * 100)}%` }} />
        </span>
      </span>
    </div>
  );
}

function Legend({ view }: { view: FloorView }) {
  if (view === 'heat') {
    return (
      <div className="legend">
        <span className="label">People density</span>
        <div className="legend-bar" style={{ background: cssRamp('heat') }} />
        <div className="legend-ends mono">
          <span>empty</span>
          <span>crowded</span>
        </div>
      </div>
    );
  }
  const [a, b] = TEMP_RANGE;
  const pos = (v: number) => `${((v - a) / (b - a)) * 100}%`;
  return (
    <div className="legend">
      <span className="label">Room air temperature</span>
      <div className="legend-bar" style={{ background: cssRamp('temp') }}>
        <span className="legend-band" style={{ left: pos(COMFORT_LO), width: `calc(${pos(COMFORT_HI)} - ${pos(COMFORT_LO)})` }} />
      </div>
      <div className="legend-ends mono">
        <span>{a} °C</span>
        <span className="legend-mid" style={{ left: pos((COMFORT_LO + COMFORT_HI) / 2) }}>
          comfort {COMFORT_LO} to {COMFORT_HI}
        </span>
        <span>{b} °C</span>
      </div>
    </div>
  );
}

export default function Twin() {
  const [view, setView] = useState<FloorView>('live');
  const tags = useRef<AnchorEls>({});
  return (
    <div className="twin">
      <Stage camera={{ position: [-12, 32, 40], fov: 30 }}>
        <FloorLights />
        <FloorScene source="cool" view={view} tags={tags} />
        <OrbitControls makeDefault enablePan={false} enableDamping dampingFactor={0.08} minDistance={26} maxDistance={110} minPolarAngle={0.2} maxPolarAngle={1.32} />
        <Framing span={38} from={[-0.3, 0.74, 0.92]} target={[0, 0.3, 0.6]} inset={{ left: 380, bottom: 200, top: 40 }} />
      </Stage>
      <Tags els={tags} source="cool" />

      <div className="twin-top">
        <div className="seg" role="group" aria-label="View">
          {VIEWS.map((v) => (
            <button key={v.id} aria-pressed={view === v.id} onClick={() => setView(v.id)} title={v.hint}>
              {v.label}
            </button>
          ))}
        </div>
        <p className="twin-hint">{VIEWS.find((v) => v.id === view)!.hint}</p>
      </div>

      <aside className="twin-side">
        <DecisionCard />
        <div className="twin-legend">
          <Legend view={view} />
          <Weather />
        </div>
      </aside>

      <footer className="twin-foot">
        <ModeLegend />
        <Timeline />
      </footer>
    </div>
  );
}
