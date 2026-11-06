/**
 * Formato es-EC en USD: $1.234,56. Se arma a mano porque Intl con es-EC no agrupa
 * los miles de 4 dígitos en todos los motores (Chrome muestra "$1234,56").
 */
export function formatMoney(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(Math.round(n * 100) / 100);
  const [int, dec] = abs.toFixed(2).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}$${grouped},${dec}`;
}

export function formatPct(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits).replace('.', ',')} %`;
}

/** Acepta "1.234,56", "1234.56", "1234,56" o "$ 1.234,56". */
export function parseMoney(input: string): number {
  const s = input.trim().replace(/[$\s]/g, '');
  if (s === '') return NaN;
  let normalized = s;
  if (s.includes(',') && s.includes('.')) {
    normalized =
      s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    normalized = s.replace(',', '.');
  }
  return Number(normalized);
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_LONG = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** '2026-11-16' → '16 nov 2026' */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** '2027-11' → 'noviembre 2027' (o 'nov-2027' con short) */
export function formatMonth(ym: string, short = false): string {
  const [y, m] = ym.split('-').map(Number);
  return short ? `${MONTHS[m - 1]}-${y}` : `${MONTHS_LONG[m - 1]} ${y}`;
}
