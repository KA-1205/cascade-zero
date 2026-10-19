'use client';

import React, { useState, useEffect } from 'react';
import { isMockMode } from '@/lib/api';
import { mockRun } from '@/lib/fixtures';

interface HeaderProps {
  onMenuToggle: () => void;
}

export function Header({ onMenuToggle }: HeaderProps) {
  const [currentTime, setCurrentTime] = useState<string>('');

  useEffect(() => {
    const fmt = () =>
      new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    setCurrentTime(fmt());
    const interval = setInterval(() => setCurrentTime(fmt()), 1000);
    return () => clearInterval(interval);
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
          {mockRun.id}
        </span>
        <span style={{ color: 'var(--border)', margin: '0 2px' }}>·</span>
        <span>seed={mockRun.seed}</span>
        <span style={{ color: 'var(--border)', margin: '0 2px' }}>·</span>
        <span style={{ color: 'var(--accent)', fontWeight: 500 }}>{mockRun.scenario}</span>
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
        title="Event stream status"
      >
        <span className="live-dot" style={{ width: 7, height: 7 }} />
        <span>Live</span>
      </div>

      <div style={{ width: 1, height: 20, backgroundColor: 'var(--border)' }} />

      {/* Environment badge */}
      <div
        style={{
          padding: '3px 8px',
          borderRadius: 6,
          backgroundColor: isMockMode ? 'var(--warning-muted)' : 'var(--success-muted)',
          border: `1px solid ${isMockMode ? 'var(--warning)' : 'var(--success)'}`,
          color: isMockMode ? 'var(--warning)' : 'var(--success)',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
        }}
      >
        {isMockMode ? 'Simulator' : 'Live'}
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
