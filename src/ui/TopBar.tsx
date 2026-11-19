import { NavLink } from 'react-router-dom';
import { fmtTime } from '../engine/config';
import { useMinute } from '../state/sim';

const LINKS = [
  { to: '/agents', n: '01', label: 'Agents' },
  { to: '/twin', n: '02', label: 'Digital twin' },
  { to: '/impact', n: '03', label: 'Before / after' },
];

/** An arrow running ahead to a line: cooling that gets there before the people do. */
export function Mark({ size = 22, ink = 'var(--ink)' }: { size?: number; ink?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M5 16h13M13 9.5l6.5 6.5-6.5 6.5" fill="none" stroke={ink} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M25 8v16" stroke="var(--gold)" strokeWidth="2.8" strokeLinecap="round" />
    </svg>
  );
}

export default function TopBar() {
  const minute = useMinute();
  return (
    <header className="topbar">
      <NavLink to="/" className="brand" aria-label="Replay the introduction">
        <Mark />
        <span className="brand-name">
          CoolAhead<i>AI</i>
        </span>
        <span className="brand-sub label">Liwa University · Smart Campus</span>
      </NavLink>
      <nav className="nav" aria-label="Views">
        {LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? 'on' : '')}>
            <b>{l.n}</b>
            {l.label}
          </NavLink>
        ))}
      </nav>
      <div className="topbar-right">
        <span className="sim-chip" title="Software-only proof of concept on a simulated zone. No building system is controlled.">
          <i />
          Simulated day
          <b className="mono">{fmtTime(minute)}</b>
        </span>
      </div>
    </header>
  );
}
