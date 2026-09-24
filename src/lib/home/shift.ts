/**
 * When the shift is over (README R97). The home page opens the day with the
 * gate and the prestart; the diary's "Talk it through" waits until the shift
 * has ended, because writing the day up mid-morning is how half-days get
 * recorded as whole ones. The end of the shift is the same clock the
 * knock-off reminder runs on — 16:00 Perth (the `remind=1` cron at 08:00 UTC
 * in vercel.json); change both together. Pure, relative imports only.
 */

export const SHIFT_END_PERTH = '16:00';

/** The wall clock on site as HH:MM, whatever the device's zone. */
export function perthClock(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Perth', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h === '24' ? '00' : h}:${m}`;
}

/** True from the end of the shift until midnight on site. HH:MM strings compare as clocks. */
export function afterShift(now: Date = new Date(), end: string = SHIFT_END_PERTH): boolean {
  return perthClock(now) >= end;
}

/** "4 pm", "3:30 pm" — how the home page says when the diary opens. */
export function shiftEndLabel(end: string = SHIFT_END_PERTH): string {
  const [h, m] = end.split(':').map(Number);
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
}
