// Place search for "jump to city", via Open-Meteo's free geocoder.
import { TtlCache } from "../cache.js";

const cache = new TtlCache(60 * 60 * 1000);

export async function findPlace(query) {
  const data = await cache.getOrLoad(query.toLowerCase(), async () => {
    const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1`);
    if (!response.ok) throw new Error(`Place search failed (${response.status})`);
    return response.json();
  });
  const place = data.results?.[0];
  if (!place) return null;
  return {
    name: [place.name, place.admin1, place.country].filter(Boolean).join(", "),
    lat: place.latitude,
    lon: place.longitude
  };
}
