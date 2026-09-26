/**
 * Dollars as the app prints them: whole dollars when the figure is whole, cents when it has them — never
 * rounded away — and a dash for "not stated", never $0. Pure; safe for Node tests and the PDF build.
 */
export function fmtMoney(n: number | null | undefined, none = '—'): string {
  if (n == null || !Number.isFinite(n)) return none;
  const whole = Number.isInteger(Math.round(n * 100) / 100) && Math.round(n * 100) % 100 === 0;
  return `$${n.toLocaleString('en-AU', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}
