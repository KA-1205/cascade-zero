'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// ── Nav structure ──────────────────────────────────────────────────────────────

const NAV_SECTIONS = [
  {
    label: 'Monitor',
    items: [
      {
        href: '/overview',
        label: 'Overview',
        icon: (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
            <rect x="9" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
            <rect x="1" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
            <rect x="9" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        ),
      },
      {
        href: '/incidents',
        label: 'Incidents',
        icon: (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 1.5L1.5 13.5H14.5L8 1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M8 6.5V9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="8" cy="11.5" r="0.75" fill="currentColor" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Operate',
    items: [
      {
        href: '/plans',
        label: 'Recovery Plans',
        icon: (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 4H14M2 8H10M2 12H7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="13" cy="11" r="2.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M12.25 11L12.75 11.5L14 10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
      {
        href: '/experiments',
        label: 'Experiment Lab',
        icon: (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M6 1.5V7L2 13.5H14L10 7V1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M5 1.5H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="5.5" cy="10.5" r="1" fill="currentColor" opacity="0.6" />
            <circle cx="9" cy="11.5" r="0.75" fill="currentColor" opacity="0.6" />
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Govern',
    items: [
      {
        href: '/admin',
        label: 'Project Admin',
        icon: (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M2.5 14C3.2 11.5 5.4 10 8 10C10.6 10 12.8 11.5 13.5 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="13" cy="4" r="1.25" fill="currentColor" opacity="0.7" />
            <circle cx="3" cy="4" r="1.25" fill="currentColor" opacity="0.7" />
          </svg>
        ),
      },
      {
        href: '/audit',
        label: 'Audit Trail',
        icon: (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="1.5" width="12" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
            <path d="M5 5.5H11M5 8H9M5 10.5H7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        ),
      },
    ],
  },
] as const;

interface SidebarProps {
  open: boolean;
  onToggle: () => void;
}

export function Sidebar({ open, onToggle }: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {/* Sidebar panel */}
      <aside
        className="app-sidebar"
        data-open={open}
        style={{
          width: open ? 236 : 60,
          minWidth: open ? 236 : 60,
          background: 'var(--bg-sidebar)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          overflow: 'hidden',
          zIndex: 20,
          position: 'relative',
        }}
      >
        {/* Logo strip */}
        <div
          style={{
            height: 60,
            display: 'flex',
            alignItems: 'center',
            gap: 11,
            padding: '0 14px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          {/* Logo mark */}
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'var(--accent)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
              <path d="M8 1.5L2 4v4c0 3.3 2.5 5.7 6 6.5 3.5-.8 6-3.2 6-6.5V4L8 1.5Z" fill="white" fillOpacity="0.25" stroke="white" strokeWidth="1.2" />
              <path d="M5 8.5l2 2 4-4" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          {/* Wordmark */}
          {open && (
            <div style={{ minWidth: 0, overflow: 'hidden' }}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 800,
                  letterSpacing: '-0.025em',
                  color: 'var(--text-primary)',
                  whiteSpace: 'nowrap',
                }}
              >
                Cascade Zero
              </div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 500,
                  color: 'var(--text-muted)',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  marginTop: 1,
                  whiteSpace: 'nowrap',
                }}
              >
                Safety Firewall
              </div>
            </div>
          )}
        </div>

        {/* Nav sections */}
        <nav
          id="cascade-navigation"
          style={{ flex: 1, padding: open ? '16px 10px' : '16px 6px', display: 'flex', flexDirection: 'column', gap: 0, overflowY: 'auto', overflowX: 'hidden' }}
          role="navigation"
          aria-label="Main navigation"
        >
          {NAV_SECTIONS.map((section, si) => (
            <div key={section.label} style={{ marginBottom: si < NAV_SECTIONS.length - 1 ? 20 : 0 }}>
              {/* Section label */}
              {open && (
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: 'var(--text-muted)',
                    padding: '0 10px',
                    marginBottom: 6,
                  }}
                >
                  {section.label}
                </div>
              )}
              {!open && si > 0 && (
                <div style={{ height: 1, background: 'var(--border)', margin: '0 4px 10px' }} />
              )}

              {/* Items */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {section.items.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-label={item.label}
                      aria-current={isActive ? 'page' : undefined}
                      onClick={() => {
                        if (window.innerWidth <= 760 && open) onToggle();
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: open ? '8px 10px 8px 12px' : '9px',
                        borderRadius: 9,
                        color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                        background: isActive
                          ? 'linear-gradient(90deg, rgba(114,47,55,0.09) 0%, rgba(183,168,154,0.16) 100%)'
                          : 'transparent',
                        border: isActive
                          ? '1px solid rgba(114,47,55,0.2)'
                          : '1px solid transparent',
                        boxShadow: isActive ? '0 1px 4px rgba(114,47,55,0.08)' : 'none',
                        textDecoration: 'none',
                        fontSize: 13,
                        fontWeight: isActive ? 600 : 400,
                        letterSpacing: isActive ? '-0.01em' : '0',
                        transition: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
                        whiteSpace: 'nowrap',
                        justifyContent: open ? 'flex-start' : 'center',
                        position: 'relative',
                        overflow: 'hidden',
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) {
                          const el = e.currentTarget as HTMLAnchorElement;
                          el.style.background = 'var(--bg-hover)';
                          el.style.color = 'var(--text-primary)';
                          el.style.borderColor = 'var(--border)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) {
                          const el = e.currentTarget as HTMLAnchorElement;
                          el.style.background = 'transparent';
                          el.style.color = 'var(--text-secondary)';
                          el.style.borderColor = 'transparent';
                        }
                      }}
                    >
                      {/* Left accent bar on active */}
                      {isActive && (
                        <span
                          style={{
                            position: 'absolute',
                            left: 0,
                            top: '20%',
                            height: '60%',
                            width: 3,
                            borderRadius: '0 3px 3px 0',
                            background: 'var(--accent-gradient)',
                          }}
                        />
                      )}
                      <span style={{ flexShrink: 0, marginLeft: isActive ? 4 : 0, transition: 'margin 0.15s ease' }}>
                        {item.icon}
                      </span>
                      {open && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Version tag + collapse */}
        <div
          style={{
            padding: '10px 10px 14px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {open && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 8px',
                borderRadius: 7,
                background: 'var(--bg-hover)',
                fontSize: 11,
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--accent-gradient)',
                  flexShrink: 0,
                }}
              />
              <Link href="/" aria-label="Cascade Zero project home">Cascade Zero v0.1.0 ↗</Link>
            </div>
          )}

          <button
            onClick={onToggle}
            aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}
            aria-controls="cascade-navigation"
            aria-expanded={open}
            style={{
              width: '100%',
              padding: '7px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: open ? 'flex-end' : 'center',
              gap: 6,
              fontSize: 12,
              fontWeight: 500,
              fontFamily: 'var(--font-sans)',
              transition: 'color 0.15s ease, background 0.15s ease',
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.color = 'var(--text-primary)';
              el.style.background = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.color = 'var(--text-muted)';
              el.style.background = 'transparent';
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              style={{ transform: open ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)' }}
            >
              <path d="M9 2L4 7L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {open && <span>Collapse</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
