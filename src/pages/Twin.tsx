import { useRef, useState } from 'react';
import { OrbitControls } from '@react-three/drei';
import { COMFORT_HI, COMFORT_LO } from '../engine/config';
import { TEMP_RANGE, cssRamp } from '../lib/color';
import { MODEL } from '../lib/theme';
import { DAY, at, useMinute } from '../state/sim';
import type { AnchorEls } from '../scenes/Anchors';
import Stage, { Framing, IdleSway } from '../scenes/Stage';
import FloorScene, { type FloorView } from '../scenes/floor/FloorScene';
import DecisionCard from '../ui/DecisionCard';
import Tags, { AhuReadout } from '../ui/Tags';
import Timeline, { ModeLegend } from '../ui/Timeline';

const VIEWS: { id: FloorView; label: string; hint: string }[] = [
  { id: 'live', label: 'Live', hint: 'People, moving air and room temperature together' },
  { id: 'heat', label: 'Heat map', hint: 'Where people are, from the camera counts' },
  { id: 'thermal', label: 'Thermal', hint: 'Room air temperature against the comfort band' },
  { id: 'xray', label: 'X-ray', hint: 'One air handler feeding three rooms' },
];

/** A model-shop key light with soft shadows, a cool fill and a touch of gold from the side. */
export function FloorLights() {
  return (
    <>
      <hemisphereLight args={['#c9dbff', '#0c1c3d', 0.32]} />
      <directionalLight
        castShadow
        position={[-13, 27, 15]}
        intensity={1.45}
        color="#f4f8ff"
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
        shadow-radius={7}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
        shadow-camera-near={2}
        shadow-camera-far={70}
      />
      <directionalLight position={[16, 12, -18]} intensity={0.35} color="#9fbcff" />
      <directionalLight position={[24, 8, 12]} intensity={0.3} color="#ffd75a" />
      <fog attach="fog" args={[MODEL.fog, 75, 190]} />
    </>
  );
}

/** Outdoor temperature: the heat the zone is working against. */
function Outside() {
  const minute = useMinute();
  const tOut = at(DAY.tOut, minute + 0.5);
  return (
    <>
      <span className="label">Outside</span>
      <span className="key-out num">
        {tOut.toFixed(1)}
        <i>°C</i>
      </span>
    </>
  );
}

/** What the colours on the model mean in the current view, in one line. */
function ColourKey({ view }: { view: FloorView }) {
  const [a, b] = TEMP_RANGE;
  const pos = (v: number) => `${((v - a) / (b - a)) * 100}%`;
  return (
    <div className="key-strip">
      {view === 'heat' ? (
        <>
          <span className="label">People density</span>
          <span className="mono">empty</span>
          <span className="key-bar" style={{ background: cssRamp('heat') }} />
          <span className="mono">crowded</span>
        </>
      ) : (
        <>
          <span className="label">Room air</span>
          <span className="mono">{a}°</span>
          <span className="key-bar" style={{ background: cssRamp('temp') }}>
            <i className="key-band" style={{ left: pos(COMFORT_LO), width: `calc(${pos(COMFORT_HI)} - ${pos(COMFORT_LO)})` }} />
          </span>
          <span className="mono">{b}°</span>
          <span className="key-comfort mono">
            <i />
            comfort {COMFORT_LO} to {COMFORT_HI}°
          </span>
        </>
      )}
      <span className="key-sep" />
      <Outside />
    </div>
  );
}

export default function Twin() {
  const [view, setView] = useState<FloorView>('live');
  const tags = useRef<AnchorEls>({});
  return (
    <div className="twin">
      <Stage camera={{ position: [-22, 30, 34], fov: 28 }} studio tilt={0.09} bloom={0.42}>
        <FloorLights />
        <FloorScene source="cool" view={view} tags={tags} />
        <OrbitControls makeDefault enablePan={false} enableDamping dampingFactor={0.08} minDistance={22} maxDistance={110} minPolarAngle={0.2} maxPolarAngle={1.34} />
        <Framing span={31} from={[-0.5, 0.66, 0.82]} target={[0, 0.9, 0.2]} inset={{ left: 386, right: 50, bottom: 250, top: 104 }} />
        <IdleSway />
      </Stage>
      <Tags els={tags} source="cool" ducts={view === 'xray'} />

      <div className="twin-top seg" role="group" aria-label="View">
        {VIEWS.map((v) => (
          <button key={v.id} aria-pressed={view === v.id} onClick={() => setView(v.id)} title={v.hint}>
            {v.label}
          </button>
        ))}
      </div>

      <aside className="twin-side">
        <DecisionCard />
      </aside>

      <div className="twin-status">
        <AhuReadout />
      </div>

      <footer className="twin-foot">
        <div className="twin-keys">
          <ColourKey view={view} />
          <ModeLegend />
        </div>
        <Timeline />
      </footer>
    </div>
  );
}
