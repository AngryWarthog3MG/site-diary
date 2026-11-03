/**
 * The printed risk register (README R187) in the R117 layout: one section per
 * profile — the profile's facts, then its risks with their three ratings, the
 * controls in place and planned, and who owns each. Every verdict is the
 * model's; nothing is typed for the paper.
 */
import { CONTROL_LEVEL_SHORT } from '../incidents/controls.ts';
import {
  PROFILE_STATUS_LABEL, RISK_LABEL, SCOPE_LABEL, ratingText, riskControlState, riskRef, sortRisks,
  type ControlRow, type RiskLevel, type RiskRow,
} from '../risks/model.ts';
import { fmtDay, type Cell, type RegisterDoc, type RegisterSection, type Tone } from './model.ts';

export interface ProfilePrint {
  name: string; scope: 'company' | 'project' | 'asset'; status: 'draft' | 'current' | 'archived';
  projectCode: string | null; assetName: string | null;
  originator_name: string | null; assessor_name: string | null; owner_name: string | null;
  lastReviewedOn: string | null; reviewDue: string | null; reviewStatus: 'overdue' | 'due_soon' | 'ok' | 'none';
  risks: RiskRow[]; controls: ControlRow[];
}

const levelTone = (l: RiskLevel | null): Tone => (l === 'extreme' || l === 'high' ? 'bad' : l === 'medium' ? 'warn' : l === 'low' ? 'ok' : 'none');
const dash = (v: string | null | undefined) => (v && v.trim() ? v.trim() : '—');

function controlsText(controls: ControlRow[], kind: 'existing' | 'planned'): string {
  const rows = controls.filter((c) => c.kind === kind && c.status !== 'withdrawn');
  if (rows.length === 0) return '—';
  return rows.map((c) => `${c.critical ? '★ ' : ''}${c.description}${c.level ? ` [${CONTROL_LEVEL_SHORT[c.level]}]` : ''}${kind === 'planned' ? (c.status === 'in_place' ? ' — in place' : c.due_on ? ` — due ${fmtDay(c.due_on)}` : ' — planned') : ''}`).join('; ');
}

export function riskRegister(profiles: ProfilePrint[], scopeLine: string): RegisterDoc {
  const open = profiles.reduce((n, p) => n + p.risks.filter((r) => r.status === 'open').length, 0);
  const critical = profiles.reduce((n, p) => n + p.risks.filter((r) => r.status === 'open' && r.critical).length, 0);
  const uncontrolled = profiles.reduce((n, p) => n + p.risks.filter((r) => r.status === 'open' && riskControlState(p.controls.filter((c) => c.risk_id === r.id)) !== 'controlled').length, 0);
  const sections: RegisterSection[] = profiles.map((p) => {
    const where = p.scope === 'project' ? `Job ${p.projectCode ?? ''}` : p.scope === 'asset' ? `Asset ${p.assetName ?? ''}` : SCOPE_LABEL.company;
    const review = p.reviewDue ? `${p.reviewStatus === 'overdue' ? 'Review overdue' : 'Review due'} ${fmtDay(p.reviewDue)}${p.lastReviewedOn ? ` · last ${fmtDay(p.lastReviewedOn)}` : ''}` : 'Archived';
    const heading = `${p.name} — ${where} · ${PROFILE_STATUS_LABEL[p.status]} · originator ${dash(p.originator_name)} · assessor ${dash(p.assessor_name)} · owner ${dash(p.owner_name)} · ${review}`;
    const rows: Cell[][] = sortRisks(p.risks).map((r) => {
      const cs = p.controls.filter((c) => c.risk_id === r.id);
      const state = riskControlState(cs);
      return [
        { text: riskRef(r.seq), sub: r.critical ? 'Critical' : null, tone: r.critical ? 'bad' : 'none' },
        { text: r.task, sub: r.step },
        { text: r.hazard, sub: r.unwanted_event },
        { text: ratingText(r.inherent_level, r.inherent_likelihood, r.inherent_consequence), tone: levelTone(r.inherent_level) },
        { text: controlsText(cs, 'existing') },
        { text: ratingText(r.residual_level, r.residual_likelihood, r.residual_consequence), tone: levelTone(r.residual_level) },
        { text: controlsText(cs, 'planned') },
        { text: ratingText(r.potential_level, r.potential_likelihood, r.potential_consequence), tone: levelTone(r.potential_level) },
        { text: dash(r.owner_name) },
        r.status === 'closed'
          ? { text: 'Closed', sub: r.closed_reason, tone: 'none' }
          : { text: state === 'controlled' ? 'Controlled' : state === 'planned_only' ? 'Controls planned' : 'No controls', tone: state === 'controlled' ? 'ok' : 'bad' },
      ];
    });
    return {
      heading,
      columns: ['No.', 'Task · step', 'Hazard · unwanted event', 'Inherent', 'Existing controls', 'Residual', 'Planned controls', 'Potential', 'Owner', 'Status'],
      rows,
      empty: 'No risks on this profile yet.',
    };
  });
  return {
    title: 'Risk register',
    basis: 'WHS Act 2020 (WA) ss. 17–19 · WHS (General) Regs 2022 (WA) regs 34–38 · ISO 45001 cl. 6.1.2 · ISO 31000',
    summary: [
      scopeLine,
      `${profiles.length} ${profiles.length === 1 ? 'profile' : 'profiles'} · ${open} open ${open === 1 ? 'risk' : 'risks'} · ${critical} critical · ${uncontrolled} with no control in place`,
      `Ratings: ${Object.values(RISK_LABEL).join(' / ')} on the company's matrix at the time each was rated. ★ marks a critical control.`,
    ],
    sections,
  };
}
