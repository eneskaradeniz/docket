// Renderer entry (WO-0007). Reads the WorkOrderSource from the preload bridge
// (window.docket.source) and renders the M1 app. The renderer imports no adapter and
// no Node API; it reaches data only through the port (ADR-0006).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../ui/app/App';
import '../index.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <App source={window.docket.source} />
    </React.StrictMode>,
  );
}
