'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import { LiveAircraft } from '@/lib/types';
import { fmt, fmtClock, airportCode, delayClass } from '@/lib/format';

// Leaflet must be loaded client-side only.
const MapInner = dynamic(() => import('./MapInner'), { ssr: false });

interface Props { onOpenDelays: (airport: string) => void }

const REFRESH_MS = 10_000;
const LIST_LIMIT = 150;

export function MapTab({ onOpenDelays }: Props) {
  const [center, setCenter] = useState<[number, number]>([20.5937, 78.9629]); // India default
  const [dist, setDist] = useState(250);
  const [selectedHex, setSelectedHex] = useState<string | null>(null);
  const [aircraft, setAircraft] = useState<LiveAircraft[]>([]);
  const [flightInfo, setFlightInfo] = useState<any>(null);
  const [airlineNames, setAirlineNames] = useState<Record<string, string>>({});
  const [filterText, setFilterText] = useState('');
  const [status, setStatus] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    api.airlines().then(setAirlineNames).catch(() => {});
  }, []);

  const fetchAircraft = useCallback(async () => {
    try {
      const data = await api.aircraft(center[0], center[1], dist);
      setAircraft(data.aircraft ?? []);
      setStatus(`${data.aircraft?.length ?? 0} aircraft · updated ${new Date().toLocaleTimeString()}`);
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
    timerRef.current = setTimeout(fetchAircraft, REFRESH_MS);
  }, [center, dist]);

  useEffect(() => {
    fetchAircraft();
    return () => clearTimeout(timerRef.current);
  }, [fetchAircraft]);

  const selectAircraft = useCallback(async (hex: string) => {
    setSelectedHex(hex);
    const ac = aircraft.find(a => a.hex === hex);
    if (!ac) return;
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
  }, [aircraft]);

  const airlineOf = (a: LiveAircraft) => airlineNames[a.callsign?.match(/^([A-Z]{3})\d/)?.[1] ?? ''] ?? null;
  const filtered = aircraft
    .filter(a => !filterText || [a.callsign, a.registration, a.type].some(v => v?.includes(filterText.toUpperCase())))
    .slice(0, LIST_LIMIT);

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="w-72 shrink-0 flex flex-col border-r border-border bg-card overflow-hidden">
        <div className="p-2 border-b border-border">
          <input
            className="w-full px-2 py-1 text-sm rounded border border-input bg-background"
            placeholder="Filter by callsign / reg / type"
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
          />
        </div>
        <div className="flex-1 overflow-y-auto text-xs">
          {filtered.map(a => (
            <button
              key={a.hex}
              onClick={() => selectAircraft(a.hex)}
              className={`w-full text-left px-3 py-2 hover:bg-accent border-b border-border/50 ${a.hex === selectedHex ? 'bg-accent' : ''}`}
            >
              <div className="font-mono font-medium">{a.callsign ?? a.hex.toUpperCase()}</div>
              <div className="text-muted-foreground">
                {airlineOf(a) ?? a.type ?? '—'} · {a.onGround ? 'Ground' : `${fmt(a.altitude)} ft`}
              </div>
            </button>
          ))}
        </div>
        {flightInfo && (
          <div className="p-3 border-t border-border text-sm bg-card">
            <div className="font-semibold">{flightInfo.number ?? selectedHex?.toUpperCase()}</div>
            {flightInfo.origin && flightInfo.destination && (
              <div className="text-muted-foreground">
                {airportCode(flightInfo.origin)} → {airportCode(flightInfo.destination)}
              </div>
            )}
            {flightInfo.eta != null && (
              <div>ETA: <span className={delayClass(flightInfo.eta ? Math.round((flightInfo.eta - (flightInfo.sta ?? flightInfo.eta)) / 60_000) : null)}>{fmtClock(flightInfo.eta)}</span></div>
            )}
            {flightInfo.destination?.iata && (
              <button
                onClick={() => onOpenDelays(flightInfo.destination.iata!)}
                className="mt-1 text-xs text-primary hover:underline"
              >
                Delays at {flightInfo.destination.iata} →
              </button>
            )}
          </div>
        )}
        <div className="px-3 py-1 text-xs text-muted-foreground border-t border-border">{status}</div>
      </aside>

      {/* Map */}
      <div className="flex-1">
        <MapInner
          aircraft={aircraft}
          selectedHex={selectedHex}
          center={center}
          onSelect={selectAircraft}
          onMoveEnd={(c, d) => { setCenter(c); setDist(d); }}
        />
      </div>
    </div>
  );
}
