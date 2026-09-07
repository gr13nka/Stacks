// main.tsx — hydrate the persisted slice, render, then start the catalog
// scan so the first frame already shows "looking through the card…".

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { actions, hydrate } from './store/store';
import './styles.css';

hydrate().then(() => {
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  void actions.boot();
});
