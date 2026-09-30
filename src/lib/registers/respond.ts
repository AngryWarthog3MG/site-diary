import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fail, forbidUnlessSees, isUuid, requireApiUser } from '@/lib/api';
import { renderPdfDocument, BrowserUnavailableError } from '@/lib/pdf/render';
import { DOCKET_CSS } from '@/lib/pdf/styles';
import { EMBEDDED_FONT_CSS } from '@/lib/pdf/fonts';
import { LOGO_DATA_URI } from '@/lib/pdf/logo';
import { perthToday } from '@/lib/push/decide';
import type { Screen } from '@/lib/roles';
import { REGISTER_CSS, registerBodyHtml } from './html';
import type { RegisterDoc } from './model';

/**
 * The server half of a printed register (README R117): who is asking, which
 * job and company, then the page through the one renderer. A register is
 * returned, never stored — it is a view of the record on the day, and the
 * record is what is kept.
 */

export interface RegisterContext {
  supabase: SupabaseClient;
  project: { id: string; name: string; code: string };
  org: { id: string; name: string; code: string };
  today: string;
}

/** Resolves the caller against the job the address names, and the screen the register belongs to. */
export async function registerContext(request: Request, screen: Screen): Promise<{ ctx: RegisterContext; response: null } | { ctx: null; response: Response }> {
  const { supabase, user, response } = await requireApiUser();
  if (response || !user) return { ctx: null, response: response ?? fail('unauthenticated', 'Sign in again.', 401) };
  const projectId = new URL(request.url).searchParams.get('project');
  if (!isUuid(projectId)) return { ctx: null, response: fail('bad_request', 'Bad project id.', 400) };
  const { data: project } = await supabase.from('projects').select('id, name, code, org:organisations!inner(id, name, code)').eq('id', projectId).maybeSingle();
  if (!project) return { ctx: null, response: fail('not_found', 'That project is not on your account.', 404) };
  const refused = await forbidUnlessSees(supabase, user.id, projectId, screen);
  if (refused) return { ctx: null, response: refused };
  const org = (Array.isArray(project.org) ? project.org[0] : project.org) as { id: string; name: string; code: string };
  return { ctx: { supabase, project: { id: project.id as string, name: project.name as string, code: project.code as string }, org, today: perthToday() }, response: null };
}

export async function registerPdf(doc: RegisterDoc, ctx: RegisterContext, opts: { slug: string; scope: string }): Promise<Response> {
  const html = ['<!doctype html>', '<html lang="en-AU"><head><meta charset="utf-8">', `<title>${doc.title} — ${ctx.org.name}</title>`,
    `<style>${EMBEDDED_FONT_CSS}</style>`, `<style>${DOCKET_CSS}</style>`, `<style>${REGISTER_CSS}</style>`, '</head><body>',
    registerBodyHtml(doc, { orgName: ctx.org.name, scope: opts.scope, asOf: ctx.today, logo: LOGO_DATA_URI }),
    '</body></html>'].join('');
  try {
    const pdf = await renderPdfDocument(html, {
      title: `${doc.title} — ${ctx.org.name}`, author: ctx.org.name, subject: `${doc.title} as of ${ctx.today}`, keywords: [ctx.org.code, opts.slug, 'register'],
      instant: new Date(`${ctx.today}T00:00:00Z`), idSeed: createHash('sha256').update(html).digest('hex'),
      footerLeft: `${ctx.org.code} · ${opts.slug.toUpperCase()} REGISTER · ${ctx.today}`,
    });
    return new Response(Buffer.from(pdf), { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${ctx.org.code}_${opts.slug}_register_${ctx.today}.pdf"`, 'cache-control': 'private, no-store' } });
  } catch (err) {
    if (err instanceof BrowserUnavailableError) return fail('server_error', err.message, 501);
    return fail('server_error', `Could not render the register: ${err instanceof Error ? err.message.split('\n')[0] : 'PDF rendering failed.'}`, 500);
  }
}
