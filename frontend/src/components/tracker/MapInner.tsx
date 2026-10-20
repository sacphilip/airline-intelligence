'use client';

import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { LiveAircraft } from '@/lib/types';
import { fmt } from '@/lib/format';

const PLANE_PATH = 'M12 1.5c.8 0 1.4.9 1.4 2.2v5.2l8.1 4.7v2.1l-8.1-2.4v4.8l2.4 1.8v1.7L12 20.7l-3.8.9v-1.7l2.4-1.8v-4.8l-8.1 2.4v-2.1l8.1-4.7V3.7c0-1.3.6-2.2 1.4-2.2z';

const BANDS = [
  { max: 5000, color: 'var(--alt-1)' },
  { max: 15000, color: 'var(--alt-2)' },
  { max: 25000, color: 'var(--alt-3)' },
  { max: 35000, color: 'var(--alt-4)' },
  { max: Infinity, color: 'var(--alt-5)' },
];
const altColor = (a: LiveAircraft) => {
  if (a.onGround) return 'var(--alt-ground)';
  if (a.altitude == null) return BANDS[2].color;
  return BANDS.find(b => (a.altitude ?? 0) < b.max)!.color;
};

function planeHtml(a: LiveAircraft, selected: boolean) {
  const fill = altColor(a);
  const cls = ['plane', selected ? 'selected' : '', a.emergency ? 'emergency' : ''].join(' ');
  return `<div class="${cls}" style="transform:rotate(${a.track ?? 0}deg)">
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path d="${PLANE_PATH}" fill="${fill}"/>
    </svg></div>`;
}

function makeIcon(a: LiveAircraft, selected: boolean) {
  return L.divIcon({ className: 'plane-icon', html: planeHtml(a, selected), iconSize: [26, 26], iconAnchor: [13, 13] });
}

interface Props {
  aircraft: LiveAircraft[];
  selectedHex: string | null;
  center: [number, number];
  isActive: boolean;
  onSelect: (hex: string) => void;
  onMoveEnd: (center: [number, number], dist: number) => void;
}

function AircraftLayer({ aircraft, selectedHex, onSelect, onMoveEnd, isActive }: Omit<Props, 'center'>) {
  const map = useMap();
  const markersRef = useRef<Map<string, L.Marker>>(new Map());

  // Force resize on mount and whenever the tab becomes visible
  useEffect(() => {
    const id = setTimeout(() => map.invalidateSize(), 100);
    return () => clearTimeout(id);
  }, [map]);

  useEffect(() => {
    if (isActive) {
      const id = setTimeout(() => map.invalidateSize(), 50);
      return () => clearTimeout(id);
    }
  }, [map, isActive]);

  useMapEvents({
    moveend: () => {
      const c = map.getCenter();
      const bounds = map.getBounds();
      const dist = c.distanceTo(bounds.getNorthEast()) / 1852; // metres → NM
      onMoveEnd([c.lat, c.lng], Math.min(500, Math.ceil(dist)));
    },
  });

  useEffect(() => {
    const existing = markersRef.current;
    const seen = new Set<string>();

    aircraft.forEach(a => {
      seen.add(a.hex);
      const selected = a.hex === selectedHex;
      let m = existing.get(a.hex);
      if (!m) {
        m = L.marker([a.lat, a.lon], { icon: makeIcon(a, selected), keyboard: false })
          .bindTooltip(`<strong>${a.callsign || a.hex.toUpperCase()}</strong><br>${a.onGround ? 'Ground' : `${fmt(a.altitude)} ft · ${fmt(a.groundSpeed)} kt`}`)
          .on('click', () => onSelect(a.hex))
          .addTo(map);
        existing.set(a.hex, m);
      } else {
        m.setLatLng([a.lat, a.lon]);
        m.setIcon(makeIcon(a, selected));
        m.setTooltipContent(`<strong>${a.callsign || a.hex.toUpperCase()}</strong><br>${a.onGround ? 'Ground' : `${fmt(a.altitude)} ft · ${fmt(a.groundSpeed)} kt`}`);
      }
    });

    for (const [hex, m] of existing) {
      if (!seen.has(hex)) { m.remove(); existing.delete(hex); }
    }
  }, [aircraft, selectedHex, map, onSelect]);

  return null;
}

export default function MapInner({ aircraft, selectedHex, center, isActive, onSelect, onMoveEnd }: Props) {
  return (
    <MapContainer center={center} zoom={6} style={{ height: '100%', width: '100%' }}>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />
      <AircraftLayer aircraft={aircraft} selectedHex={selectedHex} isActive={isActive} onSelect={onSelect} onMoveEnd={onMoveEnd} />
    </MapContainer>
  );
}
