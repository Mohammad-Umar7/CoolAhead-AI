import { AHU, PHYS, ROOMS, ZONE } from '../engine/config';
import { tempCss } from '../lib/color';
import { runOf, type Source } from '../lib/frame';
import type { AnchorEls } from '../scenes/Anchors';
import { DAY, at, stepAt, useMinute } from '../state/sim';

function RoomTag({ index, source }: { index: number; source: Source }) {
  const minute = useMinute();
  const t = minute + 0.5;
  const run = runOf(source);
  const temp = at(run.ta[index], t);
  const people = Math.round(at(DAY.occ[index], t));
  const out = stepAt(run.outOfBand[index], t) === 1;
  const blind = source === 'cool' && stepAt(DAY.online[index], t) !== 1;
  return (
    <div className={`tag room-tag${out ? ' warn' : ''}`}>
      <span className="tag-id">
        {ROOMS[index].id}
        <em>{ROOMS[index].name}</em>
      </span>
      <span className="tag-temp num" style={{ color: tempCss(temp) }}>
        {temp.toFixed(1)}
        <i>°C</i>
      </span>
      {blind ? (
        <span className="tag-sub mono blind">camera offline</span>
      ) : (
        <span className="tag-sub mono">
          {people}
          <b> / {ROOMS[index].capacity}</b>
        </span>
      )}
    </div>
  );
}

/** The shared air handler in three numbers: how hard the fan runs, how cold the air is, what it draws. */
export function AhuReadout({ source = 'cool' }: { source?: Source }) {
  const minute = useMinute();
  const t = minute + 0.5;
  const run = runOf(source);
  const fan = stepAt(run.flow, t);
  const sup = at(run.tSupply, t);
  const kw = at(run.power, t);
  return (
    <div className="ahu-readout panel">
      <div className="ahu-head">
        <span className="label">Air handler {ZONE.id}</span>
        <span className="ahu-note">one unit, three rooms</span>
      </div>
      <div className="ahu-nums">
        <div>
          <span className="num">{Math.round(fan * 100)}</span>
          <i>%</i>
          <em>fan</em>
        </div>
        <div>
          <span className="num" style={{ color: fan > 0 ? 'var(--ice)' : undefined }}>
            {fan > 0 ? sup.toFixed(1) : '–'}
          </span>
          <i>°C</i>
          <em>supply air</em>
        </div>
        <div>
          <span className="num">{kw.toFixed(1)}</span>
          <i>kW</i>
          <em>drawing</em>
        </div>
      </div>
    </div>
  );
}

/** What the fixed duct split delivers to a room right now, wanted or not. */
function DuctTag({ index, source }: { index: number; source: Source }) {
  const minute = useMinute();
  const t = minute + 0.5;
  const run = runOf(source);
  const fan = stepAt(run.flow, t);
  const kw = (fan * AHU.mDesign * ROOMS[index].share * PHYS.cp * Math.max(0, at(run.ta[index], t) - at(run.tSupply, t))) / 1000;
  const empty = at(DAY.occ[index], t) < 1;
  const wasted = empty && kw > 0.3;
  return (
    <div className={`tag duct-tag${wasted ? ' wasted' : ''}`}>
      <span className="duct-share num">{Math.round(ROOMS[index].share * 100)}%</span>
      <span className="tag-row mono">
        of the air
        <br />
        {fan > 0 ? `${kw.toFixed(1)} kW cooling` : 'fan off'}
        {wasted && <em>room is empty</em>}
      </span>
    </div>
  );
}

/** The lecture hall is the left-hand room in the default view, so its label opens leftwards, away from its neighbours. */
const OPENS_LEFT = 1;

/** Labels pinned to the 3D model. The scene moves the wrappers; this fills them. */
export default function Tags({ els, source = 'cool', ducts = false, compact = false }: { els: React.RefObject<AnchorEls>; source?: Source; ducts?: boolean; compact?: boolean }) {
  const pin = (key: string) => (el: HTMLDivElement | null) => {
    els.current[key] = el;
  };
  return (
    <div className={`tags${compact ? ' compact' : ''}`} aria-hidden="true">
      {ROOMS.map((_, i) => (
        <div key={i} className={`tag-pin${i === OPENS_LEFT ? ' left' : ''}`} ref={pin(`room${i}`)}>
          <RoomTag index={i} source={source} />
        </div>
      ))}
      {ROOMS.map((_, i) => (
        <div key={`d${i}`} className={`tag-pin left fade${ducts ? ' on' : ''}`} ref={pin(`duct${i}`)}>
          <DuctTag index={i} source={source} />
        </div>
      ))}
    </div>
  );
}
