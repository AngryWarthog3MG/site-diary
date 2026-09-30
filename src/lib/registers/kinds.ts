/**
 * The registers the Registers screen edits in place (README R118), and the
 * ones kept on their own screens that it points to. Pure.
 */

export const REGISTER_KINDS = [
  { key: 'plant', label: 'Plant and equipment', what: 'Every machine the company runs: what it is, whose it is, its registration, its inspections, and the jobs it is on.', pdf: '/api/plant/register/pdf' },
  { key: 'chemicals', label: 'Chemicals and safety data sheets (SDS)', what: 'Every hazardous product the company keeps, the hazards on its label, the sheet held for it, and where it sits on this job.', pdf: '/api/chemicals/pdf' },
  { key: 'calibration', label: 'Calibration', what: 'Every gauge, level and meter, how often it is calibrated, and the certificate that says it measures true.', pdf: '/api/quality/equipment/pdf' },
] as const;

export type RegisterKind = (typeof REGISTER_KINDS)[number]['key'];

export function readKind(value: unknown): RegisterKind {
  return REGISTER_KINDS.some((k) => k.key === value) ? (value as RegisterKind) : 'plant';
}

/**
 * Registers whose lines are records in their own right — signed, numbered or
 * frozen — so they are kept where they are made and only pointed to from here.
 */
export const OTHER_REGISTERS: ReadonlyArray<{ href: string; label: string; what: string }> = [
  { href: '/training', label: 'Training and tickets', what: 'Who holds what, and when it expires' },
  { href: '/subcontractors', label: 'Subcontractors', what: 'Insurances, SWMS and licences' },
  { href: '/swms', label: 'SWMS and JSA', what: 'Method statements and who has signed on' },
  { href: '/incidents', label: 'Hazards and incidents', what: 'Every report and its actions' },
  { href: '/permits', label: 'Permits to work', what: 'Issued, live and closed' },
  { href: '/quality', label: 'ITPs, lots and non-conformances', what: 'The quality record' },
  { href: '/procedures', label: 'Policies and procedures', what: 'Versions and acknowledgements' },
  { href: '/variations', label: 'Variations', what: 'Each one from raised to paid' },
];
