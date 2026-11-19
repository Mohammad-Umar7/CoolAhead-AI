import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { startClock, useSim } from './state/sim';
import './styles/global.css';
import './styles/app.css';
import './styles/intro.css';
import './styles/agents.css';

startClock();
// handy while developing: window.__sim.getState().jump(9 * 60)
if (import.meta.env.DEV) (window as unknown as { __sim: typeof useSim }).__sim = useSim;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
