'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { SimBanner } from './SimBanner';

interface AppShellProps {
  children: React.ReactNode;
}

/** Static fallback shown during Sidebar's usePathname() hydration */
function SidebarFallback({ open }: { open: boolean }) {
  return (
    <aside
      style={{
        width: open ? 236 : 60,
        minWidth: open ? 236 : 60,
        backgroundColor: 'var(--bg-surface)',
        borderRight: '1px solid var(--border)',
        flexShrink: 0,
      }}
    />
  );
}

export function AppShell({ children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    const syncForViewport = () => setSidebarOpen(window.innerWidth > 760);
    syncForViewport();
    window.addEventListener('resize', syncForViewport);
    return () => window.removeEventListener('resize', syncForViewport);
  }, []);

  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <SimBanner />
      <div
        className="app-shell"
        style={{
          display: 'flex',
          height: '100vh',
          overflow: 'hidden',
          background: 'transparent',
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
          <Header menuOpen={sidebarOpen} onMenuToggle={() => setSidebarOpen((v) => !v)} />

          {/* Page content */}
          <div
            className="app-main-content"
            id="main-content"
            style={{
              flex: 1,
              overflowY: 'hidden',
              overflowX: 'hidden',
              padding: '24px',
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
