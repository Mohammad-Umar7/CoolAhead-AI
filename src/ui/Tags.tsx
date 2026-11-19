import { ROOMS, ZONE } from '../engine/config';
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

function AhuTag({ source }: { source: Source }) {
  const minute = useMinute();
  const t = minute + 0.5;
  const run = runOf(source);
  const fan = stepAt(run.flow, t);
  const sup = at(run.tSupply, t);
  const kw = at(run.power, t);
  return (
    <div className="tag ahu-tag">
      <span className="tag-id">
        {ZONE.id}
        <em>one air handler, three rooms</em>
      </span>
      <span className="tag-row mono">
        <b>fan</b> {Math.round(fan * 100)}%
      </span>
      <span className="tag-row mono">
        <b>supply</b> {fan > 0 ? `${sup.toFixed(1)} °C` : 'off'}
      </span>
      <span className="tag-row mono">
        <b>power</b> {kw.toFixed(1)} kW
      </span>
    </div>
  );
}

/** Labels pinned to the 3D model. The scene moves the wrappers; this fills them. */
export default function Tags({ els, source = 'cool', ahu = true }: { els: React.RefObject<AnchorEls>; source?: Source; ahu?: boolean }) {
  const pin = (key: string) => (el: HTMLDivElement | null) => {
    els.current[key] = el;
  };
  return (
    <div className="tags" aria-hidden="true">
      {ROOMS.map((_, i) => (
        <div key={i} className="tag-pin" ref={pin(`room${i}`)}>
          <RoomTag index={i} source={source} />
        </div>
      ))}
      {ahu && (
        <div className="tag-pin" ref={pin('ahu')}>
          <AhuTag source={source} />
        </div>
      )}
    </div>
  );
}
