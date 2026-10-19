'use client';

import React, { useState, Suspense } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { SimBanner } from './SimBanner';
import { isMockMode } from '@/lib/api';

interface AppShellProps {
  children: React.ReactNode;
}

/** Static fallback shown during Sidebar's usePathname() hydration */
function SidebarFallback({ open }: { open: boolean }) {
  return (
    <aside
      style={{
        width: open ? 220 : 56,
        minWidth: open ? 220 : 56,
        backgroundColor: 'var(--bg-surface)',
        borderRight: '1px solid var(--border)',
        flexShrink: 0,
      }}
    />
  );
}

export function AppShell({ children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: 'var(--bg-base)',
      }}
    >
      {/* Sidebar — wrapped in Suspense because usePathname() is a runtime hook */}
      <Suspense fallback={<SidebarFallback open={sidebarOpen} />}>
        <Sidebar open={sidebarOpen} onToggle={() => setSidebarOpen((v) => !v)} />
      </Suspense>

      {/* Main area */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        <Header onMenuToggle={() => setSidebarOpen((v) => !v)} />

        {/* Sim banner */}
        {isMockMode && <SimBanner />}

        {/* Page content */}
        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '24px',
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
