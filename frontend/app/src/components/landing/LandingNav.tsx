"use client";
import { useRef, useState } from "react";

const links = [
  { href: "#problem", label: "Problem" },
  { href: "#how", label: "How it works" },
  { href: "#evidence", label: "Evidence" },
  { href: "#scope", label: "Scope" },
];

export function LandingNav() {
  const menuButton = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <header className="lp-nav" onKeyDown={event => { if (event.key === "Escape") { setOpen(false); menuButton.current?.focus(); } }}>
      <a className="lp-logo" href="#top" aria-label="Cascade Zero home">
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
          <path d="M3 4h16M6 9h13M9 14h10M12 19h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        Cascade Zero
      </a>
      <nav id="lp-menu" aria-label="Primary" className={open ? "lp-links is-open" : "lp-links"}>
        {links.map((l) => (
          <a key={l.href} href={l.href} onClick={() => setOpen(false)}>{l.label}</a>
        ))}
        <a className="lp-btn lp-btn-solid lp-nav-cta" href="/overview">Open the console</a>
      </nav>
      <button
        ref={menuButton}
        type="button"
        className="lp-burger"
        aria-expanded={open}
        aria-controls="lp-menu"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
      >
        <span /><span />
      </button>
    </header>
  );
}
