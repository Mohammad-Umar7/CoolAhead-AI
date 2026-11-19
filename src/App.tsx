import { lazy, Suspense } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import TopBar from './ui/TopBar';

const Intro = lazy(() => import('./pages/Intro'));
const Twin = lazy(() => import('./pages/Twin'));
const Vision = lazy(() => import('./pages/Vision'));
const Compare = lazy(() => import('./pages/Compare'));
const Agents = lazy(() => import('./pages/Agents'));

export default function App() {
  const { pathname } = useLocation();
  const intro = pathname === '/';
  return (
    <div className="app">
      <div className="backdrop" />
      <main className="stage">
        <Suspense fallback={<div className="stage-wait label">Loading</div>}>
          <Routes>
            <Route path="/" element={<Intro />} />
            <Route path="/twin" element={<Twin />} />
            <Route path="/vision" element={<Vision />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/agents" element={<Agents />} />
          </Routes>
        </Suspense>
      </main>
      {!intro && <TopBar />}
    </div>
  );
}
