'use client';

import React, { useState, useEffect } from 'react';
import { api } from '@/lib/api';

interface HeaderProps {
  onMenuToggle: () => void;
}

export function Header({ onMenuToggle }: HeaderProps) {
  const [currentTime, setCurrentTime] = useState<string>('');
  const [runId, setRunId] = useState<string>('No run selected');
  const [apiLive, setApiLive] = useState(false);

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
    // The indicator must tell the truth: probe the backend instead of
    // painting a permanent green dot.
    let cancelled = false;
    const check = async () => {
      try {
        const health = await api.getHealth();
        if (!cancelled) setApiLive(health.status === 'ok');
      } catch {
        if (!cancelled) setApiLive(false);
      }
    };
    check();
    const interval = setInterval(check, 30000);
    return () => { cancelled = true; clearInterval(interval); };
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
        height: 60,
        backgroundColor: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
        boxShadow: '0 1px 0 0 rgba(42,159,192,0.10), 0 4px 20px 0 rgba(42,159,192,0.03)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 24px',
        flexShrink: 0,
        zIndex: 10,
        position: 'relative',
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
          padding: '5px 12px',
          backgroundColor: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 9,
          fontSize: 12,
          color: 'var(--text-secondary)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M6 3.5V6L7.5 7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, letterSpacing: '-0.01em' }}>
          Run {typeof runId === 'string' ? runId.slice(0, 8) : '—'}
        </span>
        <span style={{ color: 'var(--border)', margin: '0 2px' }}>·</span>
        <span
          style={{
            fontWeight: 500,
            background: 'linear-gradient(90deg, #2a9fc0, #6c5fe0)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          live run
        </span>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Live API status — reflects a real health probe, not a static dot */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          color: 'var(--text-secondary)',
        }}
        title="Live backend connection"
      >
        <span
          className="live-dot"
          style={{
            width: 7,
            height: 7,
            background: apiLive ? undefined : 'var(--danger)',
            animation: apiLive ? undefined : 'none',
          }}
        />
        <span>{apiLive ? 'Live API' : 'API offline'}</span>
      </div>

      <div style={{ width: 1, height: 20, backgroundColor: 'var(--border)' }} />

      {/* Environment badge */}
      <div
        style={{
          padding: '3px 8px',
          borderRadius: 6,
          backgroundColor: 'var(--accent-muted, rgba(42, 159, 192, 0.12))',
          border: '1px solid var(--accent, #2a9fc0)',
          color: 'var(--accent, #2a9fc0)',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
        }}
      >
        AI Recovery Engine
      </div>

      {/* Clock */}
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          fontWeight: 500,
          color: 'var(--text-muted)',
          letterSpacing: '0.04em',
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
