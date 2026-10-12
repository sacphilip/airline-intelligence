'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import { LiveAircraft } from '@/lib/types';
import { fmt, fmtClock, airportCode, delayClass } from '@/lib/format';

const MapInner = dynamic(() => import('./MapInner'), { ssr: false });

interface Props { onOpenDelays: (airport: string) => void; isActive: boolean }

const REFRESH_MS = 10_000;
const LIST_LIMIT = 150;

function altColor(altitude: number | null | undefined) {
  if (!altitude || altitude < 100) return '#64748b';
  if (altitude < 8000)  return '#22c55e';
  if (altitude < 18000) return '#84cc16';
  if (altitude < 28000) return '#eab308';
  if (altitude < 38000) return '#f97316';
  return '#ef4444';
}

export function MapTab({ onOpenDelays, isActive }: Props) {
  const [center, setCenter] = useState<[number, number]>([20.5937, 78.9629]);
  const [dist, setDist]     = useState(500);
  const [selectedHex, setSelectedHex] = useState<string | null>(null);
  const [aircraft, setAircraft]       = useState<LiveAircraft[]>([]);
  const [flightInfo, setFlightInfo]   = useState<any>(null);
  const [airlineNames, setAirlineNames] = useState<Record<string, string>>({});
  const [filterText, setFilterText]   = useState('');
  const [status, setStatus]           = useState('');
  const [loadingFlight, setLoadingFlight] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => { api.airlines().then(setAirlineNames).catch(() => {}); }, []);

  const fetchAircraft = useCallback(async () => {
    try {
      const data = await api.aircraft(center[0], center[1], dist);
      setAircraft(data.aircraft ?? []);
      setStatus(`${data.aircraft?.length ?? 0} aircraft · ${new Date().toLocaleTimeString()}`);
    } catch (err: any) {
      setStatus(`⚠ ${err.message}`);
    }
    timerRef.current = setTimeout(fetchAircraft, REFRESH_MS);
  }, [center, dist]);

  useEffect(() => {
    fetchAircraft();
    return () => clearTimeout(timerRef.current);
  }, [fetchAircraft]);

  const selectAircraft = useCallback(async (hex: string) => {
    setSelectedHex(hex);
    setFlightInfo(null);
    const ac = aircraft.find(a => a.hex === hex);
    if (!ac) return;
    setLoadingFlight(true);
    try {
      const info = await api.flight({
        hex, callsign: ac.callsign ?? undefined,
        lat: ac.lat, lon: ac.lon,
        gs: ac.groundSpeed ?? undefined,
        ground: ac.onGround,
        type: ac.type ?? undefined,
      });
      setFlightInfo(info);
    } catch { setFlightInfo(null); }
    finally { setLoadingFlight(false); }
  }, [aircraft]);

  const airlineOf = (a: LiveAircraft) =>
    airlineNames[a.callsign?.match(/^([A-Z]{3})\d/)?.[1] ?? ''] ?? null;

  const filtered = aircraft
    .filter(a => !filterText || [a.callsign, a.registration, a.type].some(v => v?.includes(filterText.toUpperCase())))
    .slice(0, LIST_LIMIT);

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="w-72 shrink-0 flex flex-col border-r border-border bg-card overflow-hidden">

        {/* Filter */}
        <div className="p-2.5 border-b border-border">
          <input
            className="w-full px-3 py-1.5 text-xs rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition"
            placeholder="Filter callsign · reg · type"
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
          />
        </div>

        {/* Aircraft list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              {status.startsWith('⚠') ? status : 'No aircraft visible'}
            </div>
          )}
          {filtered.map(a => {
            const isSelected = a.hex === selectedHex;
            const color = altColor(a.altitude);
            return (
              <button
                key={a.hex}
                onClick={() => selectAircraft(a.hex)}
                className={`w-full text-left px-3 py-2.5 border-b border-border/40 transition-colors
                  ${isSelected ? 'bg-primary/10 border-l-2 border-l-primary' : 'hover:bg-accent/50'}`}
              >
                <div className="flex items-center gap-2">
                  <span style={{ color }} className="text-sm">✈</span>
                  <span className="font-mono text-xs font-semibold">{a.callsign ?? a.hex.toUpperCase()}</span>
                  {a.onGround && <span className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground">GND</span>}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 pl-5">
                  {[airlineOf(a) ?? a.type, a.onGround ? 'On ground' : (a.altitude ? `${fmt(a.altitude)} ft` : null)].filter(Boolean).join(' · ')}
                </div>
              </button>
            );
          })}
        </div>

        {/* Flight info panel */}
        {(loadingFlight || flightInfo) && (
          <div className="border-t border-border bg-card/95 p-3 animate-slide-in">
            {loadingFlight && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                <svg className="animate-spin-slow w-3 h-3 text-primary" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                </svg>
                Looking up flight…
              </div>
            )}
            {flightInfo && !loadingFlight && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm">{flightInfo.number ?? selectedHex?.toUpperCase()}</span>
                  {flightInfo.airline?.name && (
                    <span className="text-[10px] text-muted-foreground">{flightInfo.airline.name}</span>
                  )}
                </div>
                {flightInfo.origin && flightInfo.destination && (
                  <div className="flex items-center gap-1.5 text-sm font-mono font-semibold">
                    <span>{airportCode(flightInfo.origin)}</span>
                    <span className="text-muted-foreground text-xs">→</span>
                    <span>{airportCode(flightInfo.destination)}</span>
                  </div>
                )}
                {flightInfo.eta != null && (
                  <div className="text-xs text-muted-foreground">
                    ETA <span className="font-medium text-foreground">{fmtClock(flightInfo.eta)}</span>
                  </div>
                )}
                {flightInfo.destination?.iata && (
                  <button
                    onClick={() => onOpenDelays(flightInfo.destination.iata!)}
                    className="mt-1 text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    ⏱ Delays at {flightInfo.destination.iata} →
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Status bar */}
        <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-t border-border bg-muted/30 flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          {status || 'Connecting…'}
        </div>
      </aside>

      {/* Map */}
      <div className="flex-1">
        <MapInner
          aircraft={aircraft}
          selectedHex={selectedHex}
          center={center}
          isActive={isActive}
          onSelect={selectAircraft}
          onMoveEnd={(c, d) => { setCenter(c); setDist(d); }}
        />
      </div>
    </div>
  );
}
