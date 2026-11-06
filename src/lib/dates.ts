/** Utilidades de fechas 'YYYY-MM-DD' (sin hora) en la zona del usuario. */

export const DEFAULT_TZ = 'America/Guayaquil';

/** Fecha de hoy en la zona dada, como 'YYYY-MM-DD'. */
export function todayIn(tz: string = DEFAULT_TZ, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function toUTC(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUTC(to) - toUTC(from)) / 86_400_000);
}

export function addDays(iso: string, n: number): string {
  return fromUTC(toUTC(iso) + n * 86_400_000);
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

export function lastDayOfMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
}

export function isLastDayOfMonth(iso: string): boolean {
  return lastDayOfMonth(iso) === iso.slice(0, 10);
}

/** '2026-11' + n meses */
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/** Primer día del mes: '2026-11-06' → '2026-11-01' */
export function firstOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** Fecha con el día `day` dentro del mes `ym`, recortado al último día del mes. */
export function dateInMonth(ym: string, day: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = Math.min(day, daysInMonth(y, m));
  return `${ym}-${String(d).padStart(2, '0')}`;
}
