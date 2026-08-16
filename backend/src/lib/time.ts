// IST (UTC+5:30) date helpers. The jar resets and streak logic all key off
// the IST calendar day, per spec ("new opening every day at 12:00 AM IST").

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function nowIST(): Date {
  return new Date(Date.now() + IST_OFFSET_MS);
}

export function istDateString(d: Date = nowIST()): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

export function istHour(d: Date = nowIST()): number {
  return d.getUTCHours();
}

export function isBirthdayToday(d: Date = nowIST()): boolean {
  return d.getUTCMonth() === 2 && d.getUTCDate() === 19; // March 19
}

export function greeting(name: string, d: Date = nowIST()): string {
  const h = istHour(d);
  if (h < 5) return `Still up, ${name}?`;
  if (h < 12) return `Good Morning, ${name}`;
  if (h < 17) return `Good Afternoon, ${name}`;
  if (h < 21) return `Good Evening, ${name}`;
  return `Good Night, ${name}`;
}

export function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z").getTime();
  const db = new Date(b + "T00:00:00Z").getTime();
  return Math.round((db - da) / (24 * 60 * 60 * 1000));
}
