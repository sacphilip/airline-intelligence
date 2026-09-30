'use client';

import { useState, useEffect, useCallback } from 'react';
import { MapTab } from '@/components/tracker/MapTab';
import { FlightSearchTab } from '@/components/flight/FlightSearchTab';
import { DelaysTab } from '@/components/delays/DelaysTab';

type Tab = 'map' | 'flight' | 'delays';

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('map');
  const [pendingDelaysAirport, setPendingDelaysAirport] = useState<string | null>(null);
  const [pendingFlightNumber, setPendingFlightNumber] = useState<string | null>(null);

  // Honour #flight/<number>[/<date>] and #delays deep links.
  useEffect(() => {
    const followHash = () => {
      const parts = location.hash.slice(1).split('/').map(decodeURIComponent);
      const tab = (parts[0] as Tab) || 'map';
      if (['map', 'flight', 'delays'].includes(tab)) setActiveTab(tab);
      if (tab === 'flight' && parts[1]) setPendingFlightNumber(parts[1]);
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
      {/* Tab bar */}
      <nav className="flex border-b border-border shrink-0">
        {(['map', 'flight', 'delays'] as Tab[]).map(tab => (
          <button
            key={tab}
            onClick={() => switchTab(tab)}
            aria-selected={activeTab === tab}
            className={`px-4 py-3 text-sm font-medium capitalize transition-colors
              ${activeTab === tab
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'}`}
          >
            {tab === 'map' ? '🗺 Map' : tab === 'flight' ? '✈ Find flight' : '⏱ Delays'}
          </button>
        ))}
      </nav>

      {/* Tab panels */}
      <div className="flex-1 overflow-hidden">
        <div className={activeTab === 'map' ? 'h-full' : 'hidden'}>
          <MapTab onOpenDelays={openDelays} />
        </div>
        <div className={activeTab === 'flight' ? 'h-full overflow-auto' : 'hidden'}>
          <FlightSearchTab
            initialNumber={pendingFlightNumber}
            onConsumeNumber={() => setPendingFlightNumber(null)}
          />
        </div>
        <div className={activeTab === 'delays' ? 'h-full overflow-auto' : 'hidden'}>
          <DelaysTab
            initialAirport={pendingDelaysAirport}
            onConsumeAirport={() => setPendingDelaysAirport(null)}
          />
        </div>
      </div>
    </div>
  );
}
