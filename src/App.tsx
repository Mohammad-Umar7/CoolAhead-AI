import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import TopBar from './ui/TopBar';

const Intro = lazy(() => import('./pages/Intro'));
const Agents = lazy(() => import('./pages/Agents'));
const Twin = lazy(() => import('./pages/Twin'));
const Impact = lazy(() => import('./pages/Impact'));

export default function App() {
  const { pathname } = useLocation();
  const intro = pathname === '/';
  return (
    <div className="app">
      <main className="stage">
        <Suspense fallback={<div className="stage-wait label">Loading</div>}>
          <Routes>
            <Route path="/" element={<Intro />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/twin" element={<Twin />} />
            <Route path="/impact" element={<Impact />} />
            <Route path="*" element={<Navigate to="/agents" replace />} />
          </Routes>
        </Suspense>
      </main>
      {!intro && <TopBar />}
    </div>
  );
}
