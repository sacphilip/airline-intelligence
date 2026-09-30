// Hourly forecast at an airport, via Open-Meteo (free, no key), reduced to "does this matter
// for flights?": { severity: 1 (worth noting) | 2 (likely disruptive), text } or null.
import { TtlCache } from "../cache.js";

const cache = new TtlCache(30 * 60 * 1000);

async function hourlyForecast(lat, lon) {
  return cache.getOrLoad(`${lat.toFixed(2)},${lon.toFixed(2)}`, async () => {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      "&hourly=weather_code,wind_gusts_10m,visibility&forecast_days=3&timeformat=unixtime&timezone=GMT";
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Open-Meteo request failed (${response.status})`);
    return (await response.json()).hourly;
  });
}

// WMO weather codes: https://open-meteo.com/en/docs (weather_code)
export function assessWeather({ weatherCode: wc, gustKmh: gust, visibilityM: vis }, where) {
  if ([95, 96, 99].includes(wc)) return { severity: 2, text: `Thunderstorms forecast ${where}` };
  if ([71, 73, 75, 77, 85, 86].includes(wc)) return { severity: 2, text: `Snow forecast ${where}` };
  if ([56, 57, 66, 67].includes(wc)) return { severity: 2, text: `Freezing rain forecast ${where}` };
  if (gust >= 70) return { severity: 2, text: `Very strong gusts forecast ${where} (${Math.round(gust)} km/h)` };
  if ([45, 48].includes(wc) || (vis != null && vis < 1000)) return { severity: 1, text: `Fog / low visibility forecast ${where}` };
  if (gust >= 50) return { severity: 1, text: `Strong gusts forecast ${where} (${Math.round(gust)} km/h)` };
  if ([65, 82].includes(wc)) return { severity: 1, text: `Heavy rain forecast ${where}` };
  return null;
}

export async function weatherAt(airport, time) {
  if (airport?.lat == null || airport?.lon == null || time == null) return null;
  let hourly;
  try {
    hourly = await hourlyForecast(airport.lat, airport.lon);
  } catch (error) {
    console.warn(error.message);
    return null; // weather is one input among several; never fail a prediction over it
  }
  const i = hourly?.time?.findIndex((t) => Math.abs(t * 1000 - time) <= 30 * 60000) ?? -1;
  if (i < 0) return null;
  return assessWeather({
    weatherCode: hourly.weather_code?.[i],
    gustKmh: hourly.wind_gusts_10m?.[i],
    visibilityM: hourly.visibility?.[i]
  }, `at ${airport.iata || airport.icao}`);
}
