import React, { useEffect, useState } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { useLive } from '../store';

// Small inline icon set (24x24, stroke-based) so the sidebar needs no icon library.
const Icon = {
  site: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M3 10.5 12 4l9 6.5" /><path d="M5 9.5V20h14V9.5" /><path d="M9 20v-6h6v6" />
    </svg>
  ),
  dashboard: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="3.5" y="3.5" width="7" height="9" rx="1.3" /><rect x="13.5" y="3.5" width="7" height="5" rx="1.3" />
      <rect x="13.5" y="11.5" width="7" height="9" rx="1.3" /><rect x="3.5" y="15.5" width="7" height="5" rx="1.3" />
    </svg>
  ),
  attacks: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 3 4 7v5c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V7l-8-4Z" /><path d="M9.5 12.2l1.8 1.8 3.2-3.6" />
    </svg>
  ),
  inspector: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="10.5" cy="10.5" r="6.5" /><path d="M20 20l-4.8-4.8" />
    </svg>
  ),
  learn: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M3.5 6.2 12 3l8.5 3.2L12 9.4 3.5 6.2Z" /><path d="M7 8.3v6c0 1.6 2.2 3 5 3s5-1.4 5-3v-6" /><path d="M20.5 6.2v6.3" />
    </svg>
  ),
  scorecard: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 3.5l2.3 4.8 5.2.7-3.8 3.7.9 5.2L12 15.3l-4.6 2.6.9-5.2-3.8-3.7 5.2-.7L12 3.5Z" />
    </svg>
  ),
  reset: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M20 11a8 8 0 1 0-2.4 5.7" /><path d="M20 5v6h-6" />
    </svg>
  ),
  menu: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...p}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  ),
  // Chevron that points left when the sidebar is open (click to collapse)
  // and right when it is collapsed (click to expand).
  collapse: (p) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  ),
};

const links = [
  ['/', 'Site', Icon.site],
  ['/dashboard', 'Dashboard', Icon.dashboard],
  ['/attacks', 'Attacks', Icon.attacks],
  ['/inspector', 'Inspector', Icon.inspector],
  ['/learn', 'Learn', Icon.learn],
  ['/scorecard', 'Scorecard', Icon.scorecard],
];

const COLLAPSE_KEY = 'evsoc.sidebarCollapsed';

export default function Layout({ children }) {
  const { reset } = useLive();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [collapsed]);

  return (
    <div className={`shell ${mobileOpen ? 'sidebar-open' : ''} ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <button type="button" className="menu-toggle" aria-label={mobileOpen ? 'Close menu' : 'Open menu'} onClick={() => setMobileOpen((o) => !o)}>
        <Icon.menu width="20" height="20" />
      </button>
      {mobileOpen && <div className="sidebar-scrim" onClick={() => setMobileOpen(false)} aria-hidden="true" />}

      <aside className="sidebar" aria-label="Main">
        <div className="sidebar-top">
          <Link to="/" className="wordmark" onClick={() => setMobileOpen(false)}>
            <span className="ast" aria-hidden="true">&#x2733;</span>
            <span className="wordmark-text">EV-SOC Live</span>
          </Link>
          <button
            type="button"
            className="collapse-toggle"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setCollapsed((c) => !c)}
          >
            <Icon.collapse width="16" height="16" aria-hidden="true" />
          </button>
        </div>

        <nav className="side-links">
          {links.map(([to, label, Ico]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')} onClick={() => setMobileOpen(false)} title={label}>
              <Ico width="19" height="19" aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="side-foot">
          <button type="button" className="btn sm side-reset" title="Reset" onClick={() => reset()}>
            <Icon.reset width="15" height="15" aria-hidden="true" />
            <span>Reset</span>
          </button>
        </div>
      </aside>

      <main className="content">{children}</main>
    </div>
  );
}
