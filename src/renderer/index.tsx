// Renderer entry (WO-0007). Reads the WorkOrderSource from the preload bridge
// (window.docket.source) and renders the M1 app. The renderer imports no adapter and
// no Node API; it reaches data only through the port (ADR-0006). WO-0008 also wires
// the session-runner port (window.docket.runner) into a SessionRunner for the UI.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../ui/app/App';
import { createRunnerPort } from './runner';
import '../index.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <App source={window.docket.source} runner={createRunnerPort(window.docket.runner)} />
    </React.StrictMode>,
  );
}
