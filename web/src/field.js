// Plain, general rules of thumb from the environment data the server sends (`/api/environment`).
// They are prompts to go and look at the field, not agronomic advice for a specific crop. Each result
// is a key into i18n (`advice.<key>.title` and `.text`); level is 'ok' | 'watch' | 'warn'.

export function adviceFor(f) {
  const out = [];
  const today = f.days[0];
  const soonRain = f.days.slice(0, 2).reduce((sum, day) => sum + (day.rain ?? 0), 0);
  const soonChance = Math.max(...f.days.slice(0, 2).map((day) => day.chance ?? 0));
  // Prefer the root zone: the top centimetre dries out within hours and says little about the crop.
  const moisture = f.soil.root ?? f.soil.moisture;

  if (soonChance >= 60 || soonRain >= 5) {
    out.push({ level: 'watch', key: 'rain' });
  } else if ((today.et0 ?? 0) >= 5 && soonRain < 1 && moisture != null && moisture < 20) {
    out.push({ level: 'watch', key: 'dry' });
  }
  if (f.now.wind >= 20) out.push({ level: 'watch', key: 'wind' });
  if (today.max >= 35) out.push({ level: 'warn', key: 'heat' });
  if (today.min <= 2) out.push({ level: 'warn', key: 'frost' });
  if (f.now.humidity >= 85 && f.now.temp >= 18 && f.now.temp <= 30) out.push({ level: 'watch', key: 'fungal' });
  if ((today.uv ?? 0) >= 8) out.push({ level: 'watch', key: 'uv' });
  if (f.air && f.air.aqi >= 150) out.push({ level: 'watch', key: 'air' });
  if (f.sprayWindow && !out.some((a) => a.key === 'rain' || a.key === 'wind')) out.push({ level: 'ok', key: 'spray' });

  if (out.length === 0) out.push({ level: 'ok', key: 'ok' });
  return out;
}
