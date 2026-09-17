/**
 * Environmental management as facts (README R73). Pure, relative imports only — node-tested.
 * The database holds the same rules and wins where they differ.
 */

// ---------------------------------------------------------------- aspects (ISO 14001 cl. 6.1.2)
export const CONDITIONS = ['normal', 'abnormal', 'emergency'] as const;
export type Condition = (typeof CONDITIONS)[number];
export const CONDITION_LABEL: Record<Condition, string> = { normal: 'Normal work', abnormal: 'Abnormal (start-up, breakdown, maintenance)', emergency: 'Emergency' };

/** Likelihood x consequence against the criteria's threshold — the TS half of app.env_aspects_before_write. */
export function significance(likelihood: number, consequence: number, threshold: number | null): { score: number; significant: boolean | null } {
  const score = likelihood * consequence;
  return { score, significant: threshold == null ? null : score >= threshold };
}

// ---------------------------------------------------------------- legal register (cl. 6.1.3)
export const SOURCE_TYPES = ['legislation', 'regulation', 'approval', 'licence', 'contract', 'standard', 'other'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];
export const SOURCE_LABEL: Record<SourceType, string> = {
  legislation: 'Act', regulation: 'Regulations', approval: 'Approval or permit condition', licence: 'Licence', contract: 'Contract or specification', standard: 'Standard or code', other: 'Other',
};

// ---------------------------------------------------------------- evaluations (cl. 9.1.2)
export type ComplianceResult = 'compliant' | 'non_compliant' | 'not_applicable';
export const RESULT_LABEL: Record<ComplianceResult, string> = { compliant: 'Compliant', non_compliant: 'Not compliant', not_applicable: 'Not applicable' };

export interface ObligationInScope { id: string; project_id: string | null; active: boolean }
export interface ResultFacts { legal_obligation_id: string; result: ComplianceResult; evidence: string | null; action: string | null }

/** The obligations an evaluation must cover — the TS half of app.compliance_scope_missing. */
export function inScope<T extends ObligationInScope>(obligations: readonly T[], evaluationProject: string | null): T[] {
  return obligations.filter((o) => o.active && (evaluationProject == null || o.project_id == null || o.project_id === evaluationProject));
}

/** Why an evaluation cannot be issued yet, in words; empty when it can. */
export function evaluationProblems(obligations: readonly ObligationInScope[], evaluationProject: string | null, results: readonly ResultFacts[], summary: string | null): string[] {
  const problems: string[] = [];
  const have = new Set(results.map((r) => r.legal_obligation_id));
  const missing = inScope(obligations, evaluationProject).filter((o) => !have.has(o.id)).length;
  if (missing > 0) problems.push(`${missing} obligation${missing === 1 ? '' : 's'} without a result`);
  const blank = (s: string | null) => !s || !s.trim();
  if (results.some((r) => r.result !== 'not_applicable' && blank(r.evidence))) problems.push('a result without its evidence');
  if (results.some((r) => r.result === 'non_compliant' && blank(r.action))) problems.push('a non-compliance without an action');
  if (blank(summary)) problems.push('no summary of compliance status');
  return problems;
}

// ---------------------------------------------------------------- environmental incidents (Spec 204, EP Act s. 72)
export const SEVERITIES_204 = ['insignificant', 'minor', 'moderate', 'major', 'catastrophic'] as const;
export type Severity204 = (typeof SEVERITIES_204)[number];
export const SEVERITY_204_LABEL: Record<Severity204, string> = { insignificant: 'Insignificant', minor: 'Minor', moderate: 'Moderate', major: 'Major', catastrophic: 'Catastrophic' };
/** cl. 204.28: moderate and above take the shorter report clock. */
export const usesSeriousClock = (s: Severity204) => s === 'moderate' || s === 'major' || s === 'catastrophic';

export const ENV_EVENT_KINDS = ['assessed', 'superintendent_notified', 'report_given', 'investigation_given', 'dwer_notifiable', 'dwer_phoned', 'dwer_written_notice'] as const;
export type EnvEventKind = (typeof ENV_EVENT_KINDS)[number];
export const ENV_EVENT_LABEL: Record<EnvEventKind, string> = {
  assessed: 'Severity assessed (Spec 204)',
  superintendent_notified: 'Superintendent notified',
  report_given: 'Incident report given',
  investigation_given: 'Investigation report given',
  dwer_notifiable: 'Notifiable to DWER (EP Act s. 72)',
  dwer_phoned: 'Environment WAtch phoned',
  dwer_written_notice: 'Written notice given to DWER',
};

export const DWER_TRIGGERS = ['emergency_accident_malfunction', 'breach_of_approval', 'prescribed_waste'] as const;
export type DwerTrigger = (typeof DWER_TRIGGERS)[number];
export const DWER_TRIGGER_LABEL: Record<DwerTrigger, string> = {
  emergency_accident_malfunction: 'From an emergency, accident or malfunction',
  breach_of_approval: 'In breach of an approval, licence or notice',
  prescribed_waste: 'Involves prescribed waste',
};

export interface EnvEvent {
  id: string;
  kind: EnvEventKind;
  happened_at: string;
  severity: Severity204 | null;
  serious: boolean | null;
  dwer_trigger: DwerTrigger | null;
  person_name: string | null;
  detail: string | null;
}

/** The contract's clocks for this job; null where the contract sets none. */
export interface EnvClocks { seriousHours: number | null; minorHours: number | null; investigationDays: number | null }

export interface EnvIncidentState {
  severity: Severity204 | null;
  serious: boolean;
  superintendentNotifiedAt: string | null;
  reportDueAt: string | null;
  reportGivenAt: string | null;
  reportOverdue: boolean;
  investigationDueAt: string | null;
  investigationGivenAt: string | null;
  investigationOverdue: boolean;
  dwerNotifiable: boolean;
  dwerTrigger: DwerTrigger | null;
  dwerPhonedAt: string | null;
  dwerWrittenAt: string | null;
  /** What is still to do, in words, most urgent first. */
  outstanding: string[];
}

const addHours = (iso: string, hours: number) => new Date(Date.parse(iso) + hours * 3_600_000).toISOString();
const first = (events: readonly EnvEvent[], kind: EnvEventKind) =>
  events.filter((e) => e.kind === kind).sort((a, b) => a.happened_at.localeCompare(b.happened_at))[0] ?? null;
const latest = (events: readonly EnvEvent[], kind: EnvEventKind) =>
  events.filter((e) => e.kind === kind).sort((a, b) => b.happened_at.localeCompare(a.happened_at))[0] ?? null;

/**
 * The trail's state. The report clock runs from when the incident happened — the
 * earliest it could have become known, so a due time is never later than the
 * contract's — by the latest assessment's severity. The investigation clock runs
 * from the superintendent's notification, for a Serious incident only.
 */
export function envIncidentState(occurredAt: string, events: readonly EnvEvent[], clocks: EnvClocks, now: string): EnvIncidentState {
  const assessment = latest(events, 'assessed');
  const severity = assessment?.severity ?? null;
  const serious = assessment?.serious === true;
  const notified = first(events, 'superintendent_notified');
  const report = first(events, 'report_given');
  const investigation = first(events, 'investigation_given');
  const dwer = latest(events, 'dwer_notifiable');
  const phoned = first(events, 'dwer_phoned');
  const written = first(events, 'dwer_written_notice');

  const reportHours = severity == null ? null : usesSeriousClock(severity) ? clocks.seriousHours : clocks.minorHours;
  const reportDueAt = reportHours == null ? null : addHours(occurredAt, reportHours);
  const reportOverdue = reportDueAt != null && !report && now > reportDueAt;
  const investigationDueAt = serious && notified && clocks.investigationDays != null ? addHours(notified.happened_at, clocks.investigationDays * 24) : null;
  const investigationOverdue = investigationDueAt != null && !investigation && now > investigationDueAt;

  const outstanding: string[] = [];
  if (dwer && !written) outstanding.push(phoned ? 'Written notice to DWER — the phone call does not meet s. 72 on its own' : 'Written notice to DWER, as soon as practicable (EP Act s. 72)');
  if (!assessment) outstanding.push('Assess the severity on the contract’s scale');
  if (!notified) outstanding.push('Notify the Superintendent, as soon as practicable');
  if (reportDueAt && !report) outstanding.push(`Incident report ${reportOverdue ? 'overdue' : 'due'}`);
  if (investigationDueAt && !investigation) outstanding.push(`Investigation report ${investigationOverdue ? 'overdue' : 'due'}`);

  return {
    severity, serious,
    superintendentNotifiedAt: notified?.happened_at ?? null,
    reportDueAt, reportGivenAt: report?.happened_at ?? null, reportOverdue,
    investigationDueAt, investigationGivenAt: investigation?.happened_at ?? null, investigationOverdue,
    dwerNotifiable: Boolean(dwer), dwerTrigger: dwer?.dwer_trigger ?? null,
    dwerPhonedAt: phoned?.happened_at ?? null, dwerWrittenAt: written?.happened_at ?? null,
    outstanding,
  };
}

// ---------------------------------------------------------------- the rain prompt (cl. 8.1)
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Days of heavy rain with no environmental check after them. The Bureau's rain for
 * `day` is the 24 hours from 9 am on that day, so the check falls due the next day;
 * a check dated from `day` to two days after counts. Only the last `lookbackDays`.
 * A prompt, never the record: the weather days are a glance (README invariants).
 */
export function rainPrompts(
  weather: ReadonlyArray<{ day: string; rainfall_mm: number | null }>,
  envCheckDates: readonly string[],
  thresholdMm: number | null,
  today: string,
  lookbackDays = 14,
): Array<{ day: string; rainfallMm: number; dueOn: string }> {
  if (thresholdMm == null) return [];
  const from = addDays(today, -lookbackDays);
  return weather
    .filter((w) => w.rainfall_mm != null && w.rainfall_mm >= thresholdMm && w.day >= from && w.day < today)
    .filter((w) => !envCheckDates.some((d) => d >= w.day && d <= addDays(w.day, 2)))
    .map((w) => ({ day: w.day, rainfallMm: Number(w.rainfall_mm), dueOn: addDays(w.day, 1) }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

// ---------------------------------------------------------------- monitoring (cl. 9.1.1)
export const MONITORING_KINDS = ['dust', 'noise', 'vibration', 'water', 'waste', 'other'] as const;
export type MonitoringKind = (typeof MONITORING_KINDS)[number];
export const MONITORING_LABEL: Record<MonitoringKind, string> = { dust: 'Dust', noise: 'Noise', vibration: 'Vibration', water: 'Water quality', waste: 'Waste', other: 'Other' };
export type Outcome = 'within_limit' | 'exceedance' | 'observation';
export const OUTCOME_LABEL: Record<Outcome, string> = { within_limit: 'Within limit', exceedance: 'Exceedance', observation: 'Observation' };

/** The outcome the database will stamp — the TS half of app.env_monitoring_before_insert. */
export function monitoringOutcome(value: number | null, limit: number | null, stated: Outcome): Outcome {
  if (value != null && limit != null) return value > limit ? 'exceedance' : 'within_limit';
  return stated;
}
