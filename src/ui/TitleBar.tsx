import { useEffect, useState, type ReactNode } from 'react';
import { Minus, Square, Copy, X } from 'lucide-react';

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    window.dz.window.isMaximized().then(setMaximized);
    return window.dz.window.onMaximized(setMaximized);
  }, []);
  return (
    <div className="win-controls">
      <button aria-label="Minimize" onClick={() => window.dz.window.minimize()}><Minus size={15} /></button>
      <button aria-label="Maximize" onClick={() => window.dz.window.toggleMaximize()}>{maximized ? <Copy size={13} /> : <Square size={13} />}</button>
      <button aria-label="Close" className="close" onClick={() => window.dz.window.close()}><X size={16} /></button>
    </div>
  );
}

export function BrandMark() {
  return (
    <span className="brand-mark">
      {/* Same artwork as build/icon.svg: focus frame around a cursor. */}
      <svg width="13" height="13" viewBox="100 100 312 312" fill="none" stroke="#fff" strokeWidth="30" strokeLinecap="round" strokeLinejoin="round">
        <path d="M124 196V150q0-26 26-26h46M316 124h46q26 0 26 26v46M388 316v46q0 26-26 26h-46M196 388h-46q-26 0-26-26v-46" />
        <path transform="translate(198 162) scale(7.2)" d="M0 0V23L6 17.5L10 26.4L13.6 24.9L9.8 16.2H17.5Z" fill="#fff" strokeWidth="2.4" />
      </svg>
    </span>
  );
}

export function TitleBar({ children }: { children?: ReactNode }) {
  return (
    <header className="titlebar">
      {children}
      <div className="spacer" />
      <WindowControls />
    </header>
  );
}
