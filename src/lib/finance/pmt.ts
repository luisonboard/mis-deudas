export const monthlyRate = (annual: number) => annual / 12;

/** Cuota fija de un préstamo (sistema francés). */
export function pmt(principal: number, annualRate: number, months: number): number {
  const r = monthlyRate(annualRate);
  return r === 0 ? principal / months : (principal * r) / (1 - Math.pow(1 + r, -months));
}
