/**
 * The printed asset register (README R186): the company's assets — machines
 * and everything else — laid out as a document, every verdict from the
 * screen's own function. Pure, relative imports with extensions — node-tested
 * through the model it draws from.
 */
import type { Cell, RegisterDoc } from './model.ts';
import { fmtDay } from './model.ts';
import {
  CLASS_LABEL, OWNERSHIP_LABEL, categoryLabel, custodySays, describeProfile, sortVerdicts, summarise,
  type AssetVerdict, type DueStatus,
} from '../assets/model.ts';

const dash = (v: string | null | undefined) => (v && v.trim() ? v.trim() : '—');
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const toneOf: Record<DueStatus, Cell['tone']> = { overdue: 'bad', due_soon: 'warn', upcoming: 'ok', none: 'none' };

function dueCell(v: AssetVerdict): Cell {
  if (v.profiles.length === 0) return { text: 'Nothing set', sub: 'No inspection or service profile', tone: 'none' };
  const n = v.next!;
  const when = n.due ? fmtDay(n.due) : n.dueAt != null ? `at ${n.dueAt.toLocaleString('en-AU', { maximumFractionDigits: 1 })} h` : '—';
  const others = v.profiles.length > 1 ? ` · ${v.profiles.length - 1} more` : '';
  return { text: `${when} · ${n.profile.label}`, sub: `${describeProfile(n.profile)}${n.profile.basis ? ` · ${n.profile.basis}` : ''}${others}`, tone: toneOf[v.status] };
}

function meterCell(v: AssetVerdict): Cell {
  if (!v.meter) return { text: '—', tone: 'none' };
  return { text: `${v.meter.reading.toLocaleString('en-AU', { maximumFractionDigits: 1 })} h`, sub: `${fmtDay(v.meter.read_on)} · ${v.meter.source === 'prestart' ? 'prestart' : v.meter.source === 'service' ? 'service record' : 'read by hand'}`, tone: 'none' };
}

export function assetRegister(verdicts: readonly AssetVerdict[], today: string): RegisterDoc {
  const columns = ['No.', 'Asset', 'Class', 'Owned / hired', 'Kept at · who has it', 'Meter', 'Next due', 'Status'];
  const row = (v: AssetVerdict): Cell[] => {
    const a = v.asset;
    const who = custodySays(v.custody, today);
    return [
      { text: dash(a.asset_no), sub: a.barcode ? `Barcode ${a.barcode}` : null },
      { text: a.name, sub: [a.make_model, a.serial_no ? `S/N ${a.serial_no}` : null].filter(Boolean).join(' · ') || null },
      { text: CLASS_LABEL[a.asset_class], sub: categoryLabel(a) },
      { text: OWNERSHIP_LABEL[a.ownership] ?? a.ownership, sub: [a.supplier, a.hire_ref].filter(Boolean).join(' · ') || null },
      { text: v.custody ? who.text : dash(a.location), sub: v.custody && a.location ? `Kept at ${a.location}` : null, tone: who.tone },
      meterCell(v),
      dueCell(v),
      { text: v.profiles.length === 0 ? '—' : v.status === 'overdue' ? 'Overdue' : v.status === 'due_soon' ? 'Due soon' : 'In date', tone: v.profiles.length === 0 ? 'none' : toneOf[v.status] },
    ];
  };
  const sorted = sortVerdicts(verdicts);
  const inService = sorted.filter((v) => v.asset.active);
  const retired = sorted.filter((v) => !v.asset.active);
  const s = summarise(verdicts);
  const summary = [
    `${plural(s.inService, 'asset', 'assets')} in service${s.retired ? ` · ${s.retired} retired` : ''} · ${s.hired} hired in or a third party's`,
    `Falling due: ${s.overdue} overdue · ${s.dueSoon} due within 30 days · ${s.noProfile} with nothing set`,
    `Checked out: ${s.out}`,
  ];
  return {
    title: 'Asset register',
    basis: 'WHS (General) Regulations 2022 (WA) regs 213 and 237 (plant) · AS/NZS 3760 (electrical test and tag) · AS 1851 (fire equipment) · AS/NZS 1891.4 (harnesses) · AS 2550.1 (lifting gear)',
    summary,
    sections: [
      { heading: 'In service', columns, rows: inService.map(row), empty: 'No assets are recorded. Add them under Assets & equipment.' },
      ...(retired.length ? [{ heading: 'Retired — kept for the record', columns, rows: retired.map((v) => { const r = row(v); r[7] = { text: `Retired${v.asset.retired_reason ? ` · ${v.asset.retired_reason}` : ''}`, tone: 'none' }; return r; }), empty: '' }] : []),
    ],
  };
}
