// Composition root (ADR-0006). The ONLY module that imports an adapter.
// M2 replaces this harness with the Electron main process; nothing under src/core or src/ui moves.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createFixtureSource } from './adapters/fixtures';
import { App } from './ui/app/App';
import './index.css';

const source = createFixtureSource();
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <App source={source} />
    </React.StrictMode>,
  );
}
