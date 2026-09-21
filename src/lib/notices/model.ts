/**
 * Notices to the head contractor, and the site events they stand on (README R90).
 *
 * A notice is written by a person and sent by a person. What the app does is
 * keep the clock honest: the contract wants prompt notice, so every unsent
 * draft shows how long ago the thing happened — counted from the moment the
 * supervisor said it happened, or from the day itself when no time was said.
 *
 * Pure, relative imports only — node-tested.
 */

export interface EventForNotice {
  said_text: string;
  location: string | null;
  directed_by: string | null;
  /** HH:MM or HH:MM:SS, when the supervisor said one. */
  occurred_time: string | null;
  /** YYYY-MM-DD, the diary day. */
  entry_date: string;
}

export interface NoticeForm {
  what_happened: string;
  why_outside_scope: string;
  work_affected: string;
  what_we_need: string;
  evidence: string;
}

/** N-007: how a notice reads on screen and on paper. */
export function noticeRef(seq: number): string {
  return `N-${String(seq).padStart(3, '0')}`;
}

/**
 * The instant an event happened, in Perth. The diary day at the time said, or
 * at knock-off (17:00) when no time was said — a late answer, never an early
 * one, so the clock never flatters us. Perth has no daylight saving; +8 is fixed.
 */
export function eventInstant(event: Pick<EventForNotice, 'entry_date' | 'occurred_time'>): string {
  const time = event.occurred_time && /^\d{2}:\d{2}/.test(event.occurred_time) ? event.occurred_time.slice(0, 5) : '17:00';
  return `${event.entry_date}T${time}:00+08:00`;
}

/** Whole hours since the event, never negative. */
export function hoursSince(event: Pick<EventForNotice, 'entry_date' | 'occurred_time'>, now: string): number {
  const then = Date.parse(eventInstant(event));
  const at = Date.parse(now);
  if (!Number.isFinite(then) || !Number.isFinite(at)) return 0;
  return Math.max(0, Math.floor((at - then) / 3_600_000));
}

/** "3 hours ago", "2 days ago" — the one figure a PM reads on an unsent draft. */
export function sinceText(hours: number): string {
  if (hours < 1) return 'under an hour ago';
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * Form 1, pre-filled from the event. Only what the event actually says goes
 * in: the words as the supervisor said them, with where and who and when
 * beneath. The rest is left for the person to write — a notice that says why
 * something is outside scope is an opinion, and the app holds none.
 */
export function draftFromEvent(event: EventForNotice): NoticeForm {
  const when = event.occurred_time ? ` at ${event.occurred_time.slice(0, 5)}` : '';
  const where = event.location ? ` at ${event.location}` : '';
  const who = event.directed_by ? ` Directed by ${event.directed_by}.` : '';
  return {
    what_happened: `${event.said_text.trim()}\n\n— site diary, ${fmtDate(event.entry_date)}${when}${where}.${who}`,
    why_outside_scope: '',
    work_affected: '',
    what_we_need: '',
    evidence: `Site diary entry of ${fmtDate(event.entry_date)}, signed.`,
  };
}

/** What the person has still to write before it can go. Advice, never a block. */
export function draftGaps(form: NoticeForm): string[] {
  const gaps: string[] = [];
  if (!form.what_happened.trim()) gaps.push('what happened');
  if (!form.why_outside_scope.trim()) gaps.push('why it is outside our scope');
  if (!form.work_affected.trim()) gaps.push('the work affected');
  if (!form.what_we_need.trim()) gaps.push('what we need');
  return gaps;
}

function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
