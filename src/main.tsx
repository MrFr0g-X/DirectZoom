import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { initTheme } from './theme';

// Recording overlays (bar, area picker, camera preview) always stay dark.
if (/^#\/(recording-bar|area|camera-preview)/.test(location.hash)) document.documentElement.dataset.theme = 'dark';
else initTheme();

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
