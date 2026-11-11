import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { Engine } from './engine/engine';
import { EngineProvider } from './engine/context';

const engine = new Engine();
// Exposed for diagnostics and end-to-end tests; contains no image data by itself.
(window as unknown as { __bghub: Engine }).__bghub = engine;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EngineProvider engine={engine}>
      <App />
    </EngineProvider>
  </StrictMode>,
);
