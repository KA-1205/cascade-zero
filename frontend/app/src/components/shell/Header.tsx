'use client';

import React, { useState, useEffect } from 'react';

interface HeaderProps {
  onMenuToggle: () => void;
}

export function Header({ onMenuToggle }: HeaderProps) {
  const [currentTime, setCurrentTime] = useState<string>('');
  const [runId, setRunId] = useState<string>('No run selected');

  useEffect(() => {
    const fmt = () =>
      new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    // First update happens in a timer callback (not synchronously in the
    // effect body) to avoid cascading renders; the interval keeps it ticking.
    const initial = setTimeout(() => setCurrentTime(fmt()), 0);
    const interval = setInterval(() => setCurrentTime(fmt()), 1000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const update = () => setRunId(localStorage.getItem('cascade-demo-run-id') ?? 'No run selected');
    update();
    window.addEventListener('cascade-run-changed', update);
    window.addEventListener('storage', update);
    return () => { window.removeEventListener('cascade-run-changed', update); window.removeEventListener('storage', update); };
  }, []);

  return (
    <header
      style={{
        height: 56,
        backgroundColor: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 20px',
        flexShrink: 0,
        zIndex: 10,
      }}
    >
      {/* Menu toggle for mobile */}
      <button
        onClick={onMenuToggle}
        aria-label="Toggle menu"
        style={{
          display: 'none', // hidden on desktop via media — CSS handles it
          width: 32,
          height: 32,
          borderRadius: 6,
          border: '1px solid var(--border)',
          backgroundColor: 'transparent',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M1 3H13M1 7H13M1 11H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {/* Run info */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '5px 10px',
          backgroundColor: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          fontSize: 12,
          color: 'var(--text-secondary)',
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M6 3.5V6L7.5 7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
          {runId}
        </span>
        <span style={{ color: 'var(--border)', margin: '0 2px' }}>·</span>
        <span style={{ color: 'var(--accent)', fontWeight: 500 }}>backend run</span>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Live SSE status */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          color: 'var(--text-secondary)',
        }}
        title="Sandbox API mode"
      >
        <span className="live-dot" style={{ width: 7, height: 7 }} />
        <span>Sandbox API</span>
      </div>

      <div style={{ width: 1, height: 20, backgroundColor: 'var(--border)' }} />

      {/* Environment badge */}
      <div
        style={{
          padding: '3px 8px',
          borderRadius: 6,
          backgroundColor: 'var(--warning-muted)',
          border: '1px solid var(--warning)',
          color: 'var(--warning)',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
        }}
      >
        Simulated infrastructure
      </div>

      {/* Clock */}
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: 'var(--text-muted)',
          letterSpacing: '0.05em',
          minWidth: 65,
          textAlign: 'right',
        }}
        aria-label="Current time"
      >
        {currentTime}
      </div>
    </header>
  );
}
