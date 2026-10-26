'use client';

import { useState, useEffect, useCallback } from 'react';
import { MapTab } from '@/components/tracker/MapTab';
import { FlightSearchTab } from '@/components/flight/FlightSearchTab';
import { DelaysTab } from '@/components/delays/DelaysTab';
import { AirlineTab } from '@/components/airline/AirlineTab';
import { api } from '@/lib/api';

type Tab = 'map' | 'flight' | 'delays' | 'airline';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'map',     label: 'Live Map',    icon: '🗺' },
  { id: 'flight',  label: 'Find Flight', icon: '✈' },
  { id: 'delays',  label: 'Delays',      icon: '⏱' },
  { id: 'airline', label: 'Airlines',    icon: '🏷' },
];

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('map');
  const [pendingDelaysAirport, setPendingDelaysAirport] = useState<string | null>(null);
  const [pendingFlightNumber, setPendingFlightNumber]   = useState<string | null>(null);
  const [pendingAirlineIata, setPendingAirlineIata]     = useState<string | null>(null);
  const [pendingRoute, setPendingRoute]                 = useState<{ from: string; to: string } | null>(null);
  const [dark, setDark] = useState(true);
  const [currentUser, setCurrentUser] = useState<{ id: number; email: string; firstName: string | null } | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  useEffect(() => {
    api.authMe().then(setCurrentUser).catch(() => setCurrentUser(null));
  }, []);

  useEffect(() => {
    const followHash = () => {
      const parts = location.hash.slice(1).split('/').map(decodeURIComponent);
      const tab = (parts[0] as Tab) || 'map';
      if (['map', 'flight', 'delays', 'airline'].includes(tab)) setActiveTab(tab);
      if (tab === 'flight'  && parts[1]) setPendingFlightNumber(parts[1]);
      if (tab === 'airline' && parts[1]) setPendingAirlineIata(parts[1]);
      // US-009: #route/BLR/DEL opens route analytics in the Find Flight tab
      if (tab === ('route' as string) && parts[1] && parts[2]) {
        setActiveTab('flight');
        setPendingRoute({ from: parts[1].toUpperCase(), to: parts[2].toUpperCase() });
      }
    };
    followHash();
    window.addEventListener('hashchange', followHash);
    return () => window.removeEventListener('hashchange', followHash);
  }, []);

  const openDelays = useCallback((airport: string) => {
    setPendingDelaysAirport(airport);
    setActiveTab('delays');
  }, []);

  const switchTab = (tab: Tab) => {
    setActiveTab(tab);
    history.replaceState(null, '', tab === 'map' ? location.pathname : `#${tab}`);
  };

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* Header */}
      <header className="shrink-0 border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="flex items-center justify-between px-4 pt-2">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">✈</span>
            <span className="font-bold text-base tracking-tight">Flight Intelligence System</span>
            <span className="text-xs text-muted-foreground hidden sm:block">Live · ADS-B + AeroDataBox</span>
          </div>
          <div className="flex items-center gap-2">
            {/* Auth nav */}
            {currentUser ? (
              <div className="flex items-center gap-2">
                <a
                  href="/account"
                  title="Your account"
                  className="text-sm text-muted-foreground hover:text-foreground hidden sm:block"
                >
                  {currentUser.firstName ?? currentUser.email?.split('@')[0]}
                </a>
                <button
                  onClick={async () => { await api.authLogout(); location.href = '/login'; }}
                  className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition"
                >
                  Log out
                </button>
              </div>
            ) : (
              <a
                href="/login"
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition"
              >
                Log in
              </a>
            )}
            {/* Dark / light toggle */}
            <button
              onClick={() => setDark(d => !d)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition"
              title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {dark ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M21 12.79A9 9 0 1111.21 3a7 7 0 109.79 9.79z" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <nav className="flex gap-1 px-2 pt-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              aria-selected={activeTab === tab.id}
              className={`relative flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t-lg transition-all duration-150
                ${activeTab === tab.id
                  ? 'text-primary bg-background border border-b-0 border-border -mb-px'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'}`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      </header>

      {/* Tab panels */}
      <div className="flex-1 overflow-hidden">
        <div className={activeTab === 'map'    ? 'h-full' : 'hidden'}><MapTab onOpenDelays={openDelays} isActive={activeTab === 'map'} /></div>
        <div className={activeTab === 'flight' ? 'h-full overflow-auto' : 'hidden'}>
          <FlightSearchTab initialNumber={pendingFlightNumber} onConsumeNumber={() => setPendingFlightNumber(null)}
            initialRoute={pendingRoute} onConsumeRoute={() => setPendingRoute(null)} />
        </div>
        <div className={activeTab === 'delays' ? 'h-full overflow-auto' : 'hidden'}>
          <DelaysTab initialAirport={pendingDelaysAirport} onConsumeAirport={() => setPendingDelaysAirport(null)} />
        </div>
        <div className={activeTab === 'airline' ? 'h-full overflow-auto' : 'hidden'}>
          <AirlineTab initialIata={pendingAirlineIata} onConsumeIata={() => setPendingAirlineIata(null)} />
        </div>
      </div>
    </div>
  );
}
