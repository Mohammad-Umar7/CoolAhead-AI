import { NavLink } from 'react-router-dom';
import { fmtTime } from '../engine/config';
import { useMinute } from '../state/sim';

const LINKS = [
  { to: '/twin', label: 'Twin' },
  { to: '/vision', label: 'Vision' },
  { to: '/agents', label: 'Agents' },
  { to: '/compare', label: 'Before / After' },
];

export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M5 16h13M13 9.5l6.5 6.5-6.5 6.5" fill="none" stroke="var(--ice)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M25 8v16" stroke="var(--heat)" strokeWidth="2.6" strokeLinecap="round" />
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
      </NavLink>
      <nav className="nav" aria-label="Views">
        {LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? 'on' : '')}>
            {l.label}
          </NavLink>
        ))}
      </nav>
      <div className="topbar-right">
        <span className="chip" title="Software-only proof of concept. No building system is controlled.">
          <span className="dot" style={{ color: 'var(--amber)' }} />
          Simulated day
        </span>
        <span className="clock mono">{fmtTime(minute)}</span>
      </div>
    </header>
  );
}
