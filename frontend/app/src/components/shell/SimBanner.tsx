'use client';

export function SimBanner() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 20px',
        backgroundColor: 'var(--warning-muted)',
        borderBottom: '1px solid var(--warning)',
        fontSize: 12,
        color: 'var(--warning)',
        flexShrink: 0,
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M7 1.5L1 12.5H13L7 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M7 5.5V8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="7" cy="10.5" r="0.65" fill="currentColor" />
      </svg>
      <span style={{ fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', fontSize: 11 }}>
        Seeded Sandbox
      </span>
      <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>—</span>
      <span style={{ color: 'var(--text-secondary)' }}>
        Results come from the backend&apos;s deterministic infrastructure simulator. No production systems are connected.
      </span>
    </div>
  );
}
