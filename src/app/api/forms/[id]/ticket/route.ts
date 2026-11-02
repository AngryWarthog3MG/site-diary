import { fail, ok, requireApiUser, forbidUnlessSees, isUuid } from '@/lib/api';
import { competencies } from '@/lib/training/model';
import { addMonths } from '@/lib/forms/schedule';
import { perthDate } from '@/lib/pdf/dates';

export const runtime = 'nodejs';

/**
 * The VOC's one tap (README R181): a `crew_tickets` row that names the passed form it stands on. Written under the
 * caller's RLS — `crew_tickets_write_managers` decides who keeps tickets — and checked by the database: the form must
 * be completed and passed, about the person named, and its template must name this competency; one ticket per form.
 * The form never writes it by itself; this route is the tap.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return fail('bad_request', 'Bad id.', 400);
  const { supabase, user, response } = await requireApiUser();
  if (response) return response;

  const { data: s, error } = await supabase
    .from('form_submissions')
    .select('id, project_id, status, outcome, subject_person, completed_on_device_at, completed_at, template_code, revision, template:form_templates!inner(competency_key), project:projects!inner(org_id)')
    .eq('id', id).maybeSingle();
  if (error) return fail('server_error', error.message, 500);
  if (!s) return fail('not_found', 'That form is not on the file.', 404);
  const forbidden = await forbidUnlessSees(supabase, user.id, s.project_id as string, 'forms');
  if (forbidden) return forbidden;
  const tpl = (Array.isArray(s.template) ? s.template[0] : s.template) as { competency_key: string | null };
  const proj = (Array.isArray(s.project) ? s.project[0] : s.project) as { org_id: string };
  if (!tpl.competency_key) return fail('bad_request', 'This form does not assess a ticket.', 400);
  if (s.status !== 'completed' || s.outcome !== 'pass') return fail('bad_request', 'A ticket stands on a completed form that passed.', 400);
  if (!s.subject_person) return fail('bad_request', 'The form names nobody.', 400);

  const { data: comps } = await supabase.from('org_competencies').select('key, label, valid_months, active').eq('org_id', proj.org_id);
  const comp = competencies((comps ?? []) as Array<{ key: string; label: string; valid_months?: number | null; active?: boolean }>).find((c) => c.key === tpl.competency_key);
  const assessedOn = perthDate((s.completed_on_device_at ?? s.completed_at) as string);
  const { data: row, error: e } = await supabase
    .from('crew_tickets')
    .insert({
      org_id: proj.org_id, person_name: s.subject_person, ticket_type: tpl.competency_key, form_submission_id: s.id, created_by: user.id,
      issued_on: assessedOn, expires_on: comp?.validMonths ? addMonths(assessedOn, comp.validMonths) : null,
      notes: `VOC ${s.template_code} rev ${s.revision} — assessed on the form`,
    })
    .select('id, issued_on')
    .single();
  if (e) {
    if (/row-level security/i.test(e.message)) return fail('forbidden', 'Only someone who keeps the company\'s tickets records one.', 403);
    if (/crew_tickets_form_once/i.test(e.message)) return fail('bad_request', 'A ticket is already recorded from this form.', 409);
    return fail('bad_request', e.message, 400);
  }
  return ok({ id: row.id, issuedOn: row.issued_on, label: comp?.label ?? tpl.competency_key });
}
