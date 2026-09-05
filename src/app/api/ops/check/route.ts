import { createAdminClient } from '@/lib/supabase/admin';
import { fetchProduct } from '@/lib/weather/bom';
import { BOM_PRODUCT_IDS } from '@/lib/weather/derive';
import { refreshProjectWeatherDays } from '@/lib/weather/days';
import type { ProjectSite } from '@/lib/weather/resolve';

export const maxDuration = 300;
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Operations endpoint: refresh the BOM cache, and report what this host can
 * actually do.
 *
 * It exists because two capabilities are environment-dependent and fail in
 * ways that look like application bugs from the outside — whether outbound FTP
 * works (BOM permits no other automated channel), and whether a browser can be
 * launched for PDF rendering. Guessing at either from a laptop is how you find
 * out on site.
 *
 * Refreshing here rather than on the request path is the point. One poll per
 * state serves every supervisor, the Bureau sees a sane rate, and a cold
 * function is never the thing standing between a phone and its weather.
 *
 * Gated by CRON_SECRET, sent as a bearer token — the same header Vercel Cron
 * sends, so this doubles as the scheduled job.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Not authorised.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const wanted = url.searchParams.get('products');
  const products = wanted
    ? wanted.split(',').filter((p) => (BOM_PRODUCT_IDS as readonly string[]).includes(p))
    : await productsInUse();

  const report: Record<string, unknown> = {
    host: process.env.VERCEL ? `vercel:${process.env.VERCEL_REGION ?? 'unknown'}` : 'local',
    checked_at: new Date().toISOString(),
  };

  report.bom = await refreshProducts(products);
  if (url.searchParams.get('browser') === '1') report.browser = await probeBrowser();
  if (url.searchParams.get('resume') === '1') {
    report.resumed = await resumeStalled();
    report.exports = await backfillExports();
  }
  if (url.searchParams.get('backup') === '1') report.backup = await snapshotRecord();
  if (url.searchParams.get('errors') === '1') report.errors = await errorDigest();
  if (url.searchParams.get('monthly') === '1') {
    report.monthly = await sendMonthlyBundles(url.searchParams.get('force') === '1');
  }
  if (url.searchParams.get('weekly') === '1') {
    report.weekly = await sendWeeklyReports(url.searchParams.get('force') === '1');
  }
  if (url.searchParams.get('prestart') === '1') {
    report.prestart = await sendPrestartNudges(url.searchParams.get('force') === '1');
  }
  if (url.searchParams.get('weather') === '1') {
    report.weather = await refreshWeatherDays();
  }
  if (url.searchParams.get('talk') === '1') {
    report.talk = await setupWeeklyTalks(url.searchParams.get('dry') === '1');
  }
  if (url.searchParams.get('remind') === '1') {
    // force=1 bypasses the decision rules — drill support only, so the send
    // and dead-subscription cleanup paths can be proven on a weekend.
    report.reminders = await sendKnockOffReminders(url.searchParams.get('force') === '1');
  }

  return Response.json(report);
}

/**
 * The morning nudge (06:30 Perth, weekdays): a supervisor with the reminder
 * on, on an active job with no prestart yet today, gets one push. Its own
 * "told them today" mark, so it never eats the knock-off reminder's.
 */
async function sendPrestartNudges(force = false): Promise<Record<string, number | string>> {
  const [{ perthToday }, { sendPush, PushConfigError }] = await Promise.all([
    import('@/lib/push/decide'),
    import('@/lib/push/send'),
  ]);
  const admin = createAdminClient();
  const today = perthToday();

  const { data: subs, error } = await admin
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth, last_prestart_notified_on');
  if (error) return { error: error.message };
  if (!subs || subs.length === 0) return { subscriptions: 0, sent: 0 };

  const userIds = [...new Set(subs.map((s) => s.user_id as string))];
  const { data: members } = await admin
    .from('project_members')
    .select('user_id, project_id, role, project:projects!inner(active)')
    .in('user_id', userIds)
    .in('role', ['supervisor', 'admin']);
  const runs = new Map<string, string[]>();
  for (const m of members ?? []) {
    const project = Array.isArray(m.project) ? m.project[0] : m.project;
    if (!(project as { active?: boolean } | null)?.active) continue;
    const list = runs.get(m.user_id as string) ?? [];
    list.push(m.project_id as string);
    runs.set(m.user_id as string, list);
  }
  const projectIds = [...new Set([...runs.values()].flat())];
  const { data: done } = projectIds.length
    ? await admin.from('prestarts').select('project_id').eq('prestart_date', today).in('project_id', projectIds)
    : { data: [] as Array<{ project_id: string }> };
  const hasPrestart = new Set((done ?? []).map((r) => r.project_id as string));

  let sent = 0, skipped = 0, removed = 0, failed = 0;
  for (const sub of subs) {
    const projects = runs.get(sub.user_id as string) ?? [];
    const outstanding = projects.filter((id) => !hasPrestart.has(id));
    const due = force || (outstanding.length > 0 && sub.last_prestart_notified_on !== today);
    if (!due) { skipped += 1; continue; }
    let outcome: 'sent' | 'gone' | 'failed';
    try {
      outcome = await sendPush(
        { endpoint: sub.endpoint as string, p256dh: sub.p256dh as string, auth: sub.auth as string },
        {
          title: 'No prestart yet today',
          body: 'What is on, what could hurt someone, who is here. Two minutes, then hand the phone around.',
          url: outstanding.length === 1 ? `/prestart/new?project=${outstanding[0]}` : '/',
          tag: 'prestart',
        },
      );
    } catch (err) {
      if (err instanceof PushConfigError) return { error: err.message };
      outcome = 'failed';
    }
    if (outcome === 'sent') {
      sent += 1;
      await admin.from('push_subscriptions').update({ last_prestart_notified_on: today }).eq('id', sub.id);
    } else if (outcome === 'gone') {
      removed += 1;
      await admin.from('push_subscriptions').delete().eq('id', sub.id);
    } else failed += 1;
  }
  return { subscriptions: subs.length, sent, skipped, removed, failed };
}

/**
 * Monday morning: every active job gets this week's toolbox talk set up,
 * unless one already exists for the week. The topic is the one the job has
 * gone longest without, from the library; the talk is open and editable,
 * exactly as if typed. Whoever ran the last talk is named presenter.
 */
async function setupWeeklyTalks(dry = false): Promise<Record<string, unknown>> {
  const [{ perthToday }, { sendPush }] = await Promise.all([
    import('@/lib/push/decide'),
    import('@/lib/push/send'),
  ]);
  const admin = createAdminClient();
  const today = perthToday();
  const monday = (() => {
    const t = new Date(`${today}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
    return t.toISOString().slice(0, 10);
  })();
  const sunday = (() => {
    const t = new Date(`${monday}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + 6);
    return t.toISOString().slice(0, 10);
  })();

  const { data: library } = await admin
    .from('toolbox_library')
    .select('topic, summary, sort_order')
    .order('sort_order');
  if (!library || library.length === 0) return { error: 'The toolbox library is empty.' };

  const { data: projects } = await admin.from('projects').select('id, name').eq('active', true);
  const created: Array<{ project: string; topic: string; id?: string }> = [];
  const skipped: string[] = [];

  for (const project of projects ?? []) {
    const { data: thisWeek } = await admin
      .from('toolbox_talks')
      .select('id')
      .eq('project_id', project.id)
      .gte('talk_date', monday)
      .lte('talk_date', sunday)
      .limit(1);
    if (thisWeek && thisWeek.length > 0) { skipped.push(project.name as string); continue; }

    const { data: past } = await admin
      .from('toolbox_talks')
      .select('topic, talk_date, presenter_name, conducted_by')
      .eq('project_id', project.id)
      .order('talk_date', { ascending: false });
    const lastUsed = new Map<string, string>();
    for (const t of past ?? []) if (!lastUsed.has(t.topic as string)) lastUsed.set(t.topic as string, t.talk_date as string);
    const pick = [...library].sort((a, b) => {
      const la = lastUsed.get(a.topic as string) ?? '';
      const lb = lastUsed.get(b.topic as string) ?? '';
      return la === lb ? (a.sort_order as number) - (b.sort_order as number) : la < lb ? -1 : 1;
    })[0];

    // Who runs it: the last presenter, and a supervisor or admin to own the row.
    const { data: member } = await admin
      .from('project_members')
      .select('user_id')
      .eq('project_id', project.id)
      .in('role', ['supervisor', 'admin'])
      .order('role')
      .limit(1)
      .maybeSingle();
    if (!member) { skipped.push(`${project.name} (no supervisor)`); continue; }
    const presenter = (past?.[0]?.presenter_name as string | undefined) ?? 'Site supervisor';

    if (dry) { created.push({ project: project.name as string, topic: pick.topic as string }); continue; }
    const { data: talk, error } = await admin
      .from('toolbox_talks')
      .insert({
        project_id: project.id,
        talk_date: today,
        topic: pick.topic,
        summary: pick.summary,
        presenter_name: presenter,
        conducted_by: member.user_id,
      })
      .select('id')
      .single();
    if (error) { skipped.push(`${project.name} (${error.message})`); continue; }
    created.push({ project: project.name as string, topic: pick.topic as string, id: talk.id as string });

    // Tell the supervisors on that job.
    const { data: supers } = await admin
      .from('project_members')
      .select('user_id')
      .eq('project_id', project.id)
      .in('role', ['supervisor', 'admin']);
    const ids = (supers ?? []).map((m) => m.user_id as string);
    if (ids.length) {
      const { data: subs } = await admin
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .in('user_id', ids);
      for (const sub of subs ?? []) {
        await sendPush(
          { endpoint: sub.endpoint as string, p256dh: sub.p256dh as string, auth: sub.auth as string },
          {
            title: `This week's toolbox talk: ${pick.topic}`,
            body: 'Set up and ready to read out. Change it if you want something else this week.',
            url: `/toolbox/${talk.id}`,
            tag: 'toolbox',
          },
        ).catch(() => undefined);
      }
    }
  }
  return { week: `${monday}..${sunday}`, created, skipped, dry };
}

/**
 * The knock-off nudge (scheduled for 4pm Perth on weekdays): anyone with the
 * reminder on and no entry of their own today gets one push. The decision
 * rules live in lib/push/decide and are unit-tested; dead subscriptions are
 * deleted on the spot so the list never fills with ghosts.
 */
async function sendKnockOffReminders(force = false): Promise<Record<string, number | string>> {
  const [{ shouldRemind, perthToday }, { sendPush, PushConfigError }] = await Promise.all([
    import('@/lib/push/decide'),
    import('@/lib/push/send'),
  ]);

  const admin = createAdminClient();
  const today = perthToday();

  const { data: subs, error } = await admin
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth, last_notified_on');
  if (error) return { error: error.message };
  if (!subs || subs.length === 0) return { subscriptions: 0, sent: 0 };

  const userIds = [...new Set(subs.map((s) => s.user_id as string))];
  const { data: entries } = await admin
    .from('entries')
    .select('author_id')
    .eq('entry_date', today)
    .in('author_id', userIds);
  const recorded = new Set((entries ?? []).map((e) => e.author_id as string));

  let sent = 0;
  let skipped = 0;
  let removed = 0;
  let failed = 0;
  for (const sub of subs) {
    const due =
      force ||
      shouldRemind({
        perthToday: today,
        hasEntryToday: recorded.has(sub.user_id as string),
        lastNotifiedOn: (sub.last_notified_on as string | null) ?? null,
      });
    if (!due) {
      skipped += 1;
      continue;
    }
    let outcome: 'sent' | 'gone' | 'failed';
    try {
      outcome = await sendPush(
        {
          endpoint: sub.endpoint as string,
          p256dh: sub.p256dh as string,
          auth: sub.auth as string,
        },
        {
          title: 'Knock-off — nothing recorded today',
          body: 'Ninety seconds now beats a claim fight later. Talk it in before you drive off.',
          url: '/record',
          tag: 'knock-off',
        },
      );
    } catch (err) {
      if (err instanceof PushConfigError) return { error: err.message };
      outcome = 'failed';
    }
    if (outcome === 'sent') {
      sent += 1;
      await admin.from('push_subscriptions').update({ last_notified_on: today }).eq('id', sub.id);
    } else if (outcome === 'gone') {
      removed += 1;
      await admin.from('push_subscriptions').delete().eq('id', sub.id);
    } else {
      failed += 1;
    }
  }

  return { subscriptions: subs.length, sent, skipped, removed, failed };
}

/**
 * The nightly snapshot: every record table as JSON, into a reserved prefix
 * of the exports bucket that no project member can read (the policy reads
 * the first path segment as a project id). Fourteen dailies are kept. Not a
 * substitute for real point-in-time recovery — it is the copy the record
 * owns when the worst happens on a free tier.
 */
async function snapshotRecord(): Promise<Record<string, unknown>> {
  const admin = createAdminClient();
  const tables = [
    'organisations', 'projects', 'project_members', 'project_keywords', 'profiles',
    'entries', 'entry_sections', 'entry_audio', 'entry_text', 'entry_extractions',
    'labour', 'plant', 'work_items', 'variations', 'delays', 'pours', 'quantities',
    'dayworks', 'photos', 'weather', 'push_subscriptions',
  ];
  const snapshot: Record<string, unknown[]> = {};
  for (const table of tables) {
    const rows: unknown[] = [];
    for (let fromRow = 0; ; fromRow += 1000) {
      const { data, error } = await admin.from(table).select('*').range(fromRow, fromRow + 999);
      if (error) return { error: `${table}: ${error.message}` };
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    snapshot[table] = rows;
  }

  const { perthToday } = await import('@/lib/push/decide');
  const today = perthToday();
  const body = Buffer.from(JSON.stringify({ taken_at: new Date().toISOString(), tables: snapshot }));
  const { error: uploadError } = await admin.storage
    .from('exports')
    .upload(`_backups/${today}.json`, body, { contentType: 'application/json', upsert: true });
  if (uploadError) return { error: uploadError.message };

  // Retention: fourteen dailies.
  const { data: existing } = await admin.storage.from('exports').list('_backups', { limit: 100 });
  const stale = (existing ?? [])
    .map((object) => object.name)
    .sort()
    .slice(0, -14);
  if (stale.length > 0) {
    await admin.storage.from('exports').remove(stale.map((name) => `_backups/${name}`));
  }
  return { stored: `_backups/${today}.json`, bytes: body.length, pruned: stale.length };
}

/**
 * The nightly error digest: anything phones reported in the last 24 hours is
 * summarised and emailed to the operator; rows older than 30 days are
 * trimmed. Finding out from the digest beats finding out from the phone call.
 */
async function errorDigest(): Promise<Record<string, unknown>> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recent, error } = await admin
    .from('client_errors')
    .select('message, path, occurred_at')
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(50);
  if (error) return { error: error.message };

  await admin
    .from('client_errors')
    .delete()
    .lt('occurred_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

  if (!recent || recent.length === 0) return { last24h: 0 };

  const byMessage = new Map<string, { count: number; path: string | null }>();
  for (const row of recent) {
    const key = row.message as string;
    const bucket = byMessage.get(key) ?? { count: 0, path: row.path as string | null };
    bucket.count += 1;
    byMessage.set(key, bucket);
  }
  const lines = [...byMessage.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([message, info]) => `<li><b>${info.count}×</b> ${message.slice(0, 160)} <i>${info.path ?? ''}</i></li>`)
    .join('');

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SMTP_PASS?.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `Site Diary <${process.env.SMTP_SENDER ?? 'diary@kbsdailydiary.me'}>`,
      to: ['mitchell.vanzyl@gmail.com'],
      subject: `KBS Daily Diary: ${recent.length} client error${recent.length === 1 ? '' : 's'} in the last 24h`,
      html: `<div style="font-family:Arial,sans-serif"><p>Phones reported these in the last 24 hours:</p><ul>${lines}</ul></div>`,
    }),
  }).catch(() => {});

  return { last24h: recent.length, distinct: byMessage.size, emailed: true };
}

/**
 * First of the month, Perth time: the previous month's bundle goes to the
 * same distribution list as the weekly. Bundles can be heavy, so past 30 MB
 * the email carries a seven-day link instead of the attachment.
 */
async function sendMonthlyBundles(force = false): Promise<Record<string, unknown>> {
  const [{ generateMonthlyBundle }, { perthToday }] = await Promise.all([
    import('@/lib/monthly/generate'),
    import('@/lib/push/decide'),
  ]);
  const admin = createAdminClient();
  const today = perthToday();
  if (!force && !today.endsWith('-01')) return { skipped: 'not the first of the month' };

  const previousMonth = (() => {
    const t = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    t.setUTCMonth(t.getUTCMonth() - 1);
    return t.toISOString().slice(0, 7);
  })();

  const { data: projects } = await admin
    .from('projects')
    .select('id, name, code, report_emails, monthly_report_last_sent, org:organisations!inner(code)')
    .eq('active', true);

  const results: Array<Record<string, unknown>> = [];
  for (const project of projects ?? []) {
    const list = (project.report_emails as string[] | null) ?? [];
    if (list.length === 0) continue;
    if (!force && project.monthly_report_last_sent === today) {
      results.push({ project: project.code, skipped: 'already sent' });
      continue;
    }
    const orgCode = (Array.isArray(project.org) ? project.org[0] : project.org)?.code as string;
    try {
      const generation = await generateMonthlyBundle(
        admin,
        { id: project.id as string, name: project.name as string, code: project.code as string, orgCode },
        previousMonth,
      );
      if ('empty' in generation) {
        results.push({ project: project.code, skipped: 'no signed entries that month' });
        continue;
      }
      const heavy = generation.pdf.length > 30 * 1024 * 1024;
      let linkUrl: string | null = null;
      if (heavy) {
        const { data: link } = await admin.storage
          .from('exports')
          .createSignedUrl(generation.objectPath, 7 * 24 * 60 * 60);
        linkUrl = link?.signedUrl ?? null;
      }
      const send = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.SMTP_PASS?.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `Site Diary <${process.env.SMTP_SENDER ?? 'diary@kbsdailydiary.me'}>`,
          to: list,
          subject: `Monthly diary bundle — ${project.name}, ${previousMonth}`,
          html:
            `<div style="font-family:Arial,sans-serif;max-width:560px">` +
            `<p style="font-size:11px;letter-spacing:.08em;color:#1f5c33;font-weight:bold;text-transform:uppercase">Monthly diary bundle</p>` +
            `<h2 style="margin:.25em 0">${project.name} — ${previousMonth}</h2>` +
            `<p style="margin:.25em 0;color:#555">${generation.data.entries.length} signed dockets behind a cover index of serials and content hashes. Verify any docket at kbsdailydiary.me/verify.</p>` +
            (heavy && linkUrl ? `<p><a href="${linkUrl}">Download the bundle</a> (link valid seven days — too large to attach).</p>` : '') +
            `</div>`,
          attachments: heavy
            ? []
            : [
                {
                  filename: `${orgCode}_${project.code}_${previousMonth}.pdf`,
                  content: Buffer.from(generation.pdf).toString('base64'),
                },
              ],
        }),
      });
      if (!send.ok) {
        const detail = (await send.json().catch(() => ({}))) as { message?: string };
        results.push({ project: project.code, error: detail.message ?? send.status });
        continue;
      }
      await admin.from('projects').update({ monthly_report_last_sent: today }).eq('id', project.id);
      results.push({ project: project.code, sent: list.length, month: previousMonth, heavy });
    } catch (err) {
      results.push({ project: project.code, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { month: previousMonth, projects: results };
}

/**
 * Friday at Perth knock-off: every active project with a distribution list
 * gets the signed week's PDF by email. The sent-marker keeps a retried cron
 * from double-sending; force is drill support.
 */
/**
 * Any signed entry without a stored export gets one — the safety net behind
 * the sign-time render. Two per run keeps the sweep inside the budget.
 */
async function backfillExports(): Promise<Record<string, unknown>> {
  const [{ loadDocketEntry }, { collectPhotos, collectSignatures }, { renderDailyPdf }] = await Promise.all([
    import('@/lib/pdf/load'),
    import('@/lib/pdf/photos'),
    import('@/lib/pdf/render'),
  ]);
  const admin = createAdminClient();
  const { data: signed } = await admin
    .from('entries')
    .select('id, entry_no, project_id')
    .eq('status', 'signed')
    .order('signed_at', { ascending: false })
    .limit(25);
  // Existence from ONE listing per project — downloading a 7 MB PDF to learn
  // that it exists is how this sweep once timed the whole function out.
  const listed = new Map<string, Set<string>>();
  const exportsOf = async (projectId: string): Promise<Set<string>> => {
    const cached = listed.get(projectId);
    if (cached) return cached;
    const { data } = await admin.storage.from('exports').list(projectId, { limit: 1000 });
    const names = new Set((data ?? []).map((object) => object.name));
    listed.set(projectId, names);
    return names;
  };
  const rendered: string[] = [];
  for (const entry of signed ?? []) {
    if (rendered.length >= 2) break;
    const path = `${entry.project_id}/${entry.entry_no}.pdf`;
    if ((await exportsOf(entry.project_id as string)).has(`${entry.entry_no}.pdf`)) continue;
    try {
      const docket = await loadDocketEntry(admin, entry.id as string);
      if (!docket) continue;
      const pdf = await renderDailyPdf({
        entry: docket,
        photos: await collectPhotos(admin, docket),
        signatures: await collectSignatures(admin, docket),
      });
      await admin.storage
        .from('exports')
        .upload(path, Buffer.from(pdf), { contentType: 'application/pdf', upsert: false });
      rendered.push(entry.entry_no as string);
    } catch (error) {
      console.error(`export backfill failed for ${entry.entry_no}:`, error);
    }
  }
  return { rendered };
}

async function sendWeeklyReports(force = false): Promise<Record<string, unknown>> {
  const [{ generateWeeklyReport }, { perthToday }] = await Promise.all([
    import('@/lib/weekly/generate'),
    import('@/lib/push/decide'),
  ]);
  const admin = createAdminClient();
  const today = perthToday();

  const monday = (() => {
    const t = new Date(`${today}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
    return t.toISOString().slice(0, 10);
  })();
  const sunday = (() => {
    const t = new Date(`${monday}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + 6);
    return t.toISOString().slice(0, 10);
  })();

  const { data: projects, error } = await admin
    .from('projects')
    .select('id, name, code, report_emails, weekly_report_last_sent, org:organisations!inner(code)')
    .eq('active', true);
  if (error) return { error: error.message };

  const results: Array<Record<string, unknown>> = [];
  for (const project of projects ?? []) {
    const list = (project.report_emails as string[] | null) ?? [];
    if (list.length === 0) continue;
    if (!force && project.weekly_report_last_sent === today) {
      results.push({ project: project.code, skipped: 'already sent today' });
      continue;
    }
    const orgCode = (Array.isArray(project.org) ? project.org[0] : project.org)?.code as string;
    try {
      const generation = await generateWeeklyReport(
        admin,
        { id: project.id as string, name: project.name as string, code: project.code as string, orgCode },
        monday,
        sunday,
      );
      if ('empty' in generation) {
        results.push({ project: project.code, skipped: 'no signed entries this week' });
        continue;
      }
      const send = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.SMTP_PASS?.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `Site Diary <${process.env.SMTP_SENDER ?? 'diary@kbsdailydiary.me'}>`,
          to: list,
          subject: `Weekly site report — ${project.name}, ${monday} to ${sunday}`,
          html:
            `<div style="font-family:Arial,sans-serif;max-width:560px">` +
            `<p style="font-size:11px;letter-spacing:.08em;color:#1f5c33;font-weight:bold;text-transform:uppercase">Weekly site report</p>` +
            `<h2 style="margin:.25em 0">${project.name}</h2>` +
            `<p style="margin:.25em 0">${monday} to ${sunday} · ${generation.data.counts.entryCount} signed ${generation.data.counts.entryCount === 1 ? 'entry' : 'entries'}</p>` +
            `<p style="margin:.25em 0;color:#555">The report is attached. Tables are the signed record; the commentary is AI-drafted and labelled as such.</p>` +
            `</div>`,
          attachments: [
            {
              filename: `${orgCode}_${project.code}_weekly_${monday}.pdf`,
              content: Buffer.from(generation.pdf).toString('base64'),
            },
          ],
        }),
      });
      if (!send.ok) {
        const detail = (await send.json().catch(() => ({}))) as { message?: string };
        results.push({ project: project.code, error: detail.message ?? send.status });
        continue;
      }
      await admin.from('projects').update({ weekly_report_last_sent: today }).eq('id', project.id);
      results.push({ project: project.code, sent: list.length, commentary: generation.commentary });
    } catch (err) {
      results.push({ project: project.code, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { week: `${monday}..${sunday}`, projects: results };
}

/** Only refresh states that a project actually sits in. */
async function productsInUse(): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('projects')
    .select('bom_product_id, site_lat, site_lng')
    .eq('active', true);

  const { inferProductId } = await import('@/lib/weather/derive');
  const products = new Set<string>();
  for (const row of (data ?? []) as Array<{
    bom_product_id: string | null;
    site_lat: number | null;
    site_lng: number | null;
  }>) {
    const id =
      row.bom_product_id ??
      (row.site_lat != null && row.site_lng != null
        ? inferProductId(row.site_lat, row.site_lng)
        : null);
    if (id) products.add(id);
  }
  return [...products];
}

async function refreshProducts(products: string[]) {
  if (products.length === 0) {
    return { products: [], note: 'No active project has coordinates, so nothing to fetch.' };
  }

  const admin = createAdminClient();
  const results: Array<Record<string, unknown>> = [];

  for (const productId of products) {
    const started = Date.now();
    try {
      const snapshot = await fetchProduct(productId);
      const { error } = await admin.from('bom_snapshots').upsert(
        {
          product_id: productId,
          issued_at: snapshot.issuedAt,
          fetched_at: new Date().toISOString(),
          station_count: snapshot.stations.length,
          stations: snapshot.stations,
        },
        { onConflict: 'product_id' },
      );
      results.push({
        product: productId,
        ok: !error,
        stations: snapshot.stations.length,
        issued_at: snapshot.issuedAt,
        ms: Date.now() - started,
        ...(error ? { store_error: error.message } : {}),
      });
    } catch (error) {
      results.push({
        product: productId,
        ok: false,
        ms: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { products: results };
}

/**
 * Finish work the sync queue started and could not complete.
 *
 * The queue deletes its local copy as soon as a recording is safely on the
 * server, which is right — but it means a transcript that failed (a bad key, a
 * rate limit, a dropped connection) has nothing left to retry it. The Today
 * screen picks that up when someone opens it; this does it without waiting for
 * anyone to look.
 *
 * Runs with the service role, so it is a maintenance job rather than a user
 * action: it only ever touches draft entries, and a signed entry is immutable
 * regardless.
 */
async function resumeStalled() {
  const admin = createAdminClient();
  const { transcribeAudio } = await import('@/lib/transcription/deepgram');
  const { buildKeyterms } = await import('@/lib/transcription/glossary');

  const { data: segments } = await admin
    .from('entry_audio')
    .select('id, entry_id, url, mime_type, entry:entries!inner(id, project_id, status)')
    .in('transcript_status', ['pending', 'processing', 'failed'])
    .limit(20);

  const transcribed: Array<Record<string, unknown>> = [];

  for (const row of (segments ?? []) as Array<Record<string, unknown>>) {
    const entry = (Array.isArray(row.entry) ? row.entry[0] : row.entry) as {
      id: string; project_id: string; status: string;
    };
    if (entry.status !== 'draft') continue;

    try {
      const { data: file } = await admin.storage.from('entry-audio').download(row.url as string);
      if (!file) throw new Error('Audio file is missing from storage.');

      const { data: terms } = await admin.rpc('project_keyterms', {
        p_project_id: entry.project_id,
      });

      const result = await transcribeAudio(
        await file.arrayBuffer(),
        (row.mime_type as string | null) ?? null,
        buildKeyterms((terms as string[] | null) ?? []),
      );

      await admin
        .from('entry_audio')
        .update({
          transcript: result.transcript,
          transcript_status: 'done',
          transcript_provider: result.provider,
          transcript_error: null,
          transcribed_at: new Date().toISOString(),
        })
        .eq('id', row.id as string);

      transcribed.push({
        segment: row.id,
        ok: true,
        words: result.transcript.split(/\s+/).filter(Boolean).length,
        seconds: result.durationSeconds,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await admin
        .from('entry_audio')
        .update({ transcript_status: 'failed', transcript_error: message.slice(0, 500) })
        .eq('id', row.id as string);
      transcribed.push({ segment: row.id, ok: false, error: message.slice(0, 200) });
    }
  }

  // A transcript with no proposal is the other half of the same stall.
  const extracted: Array<Record<string, unknown>> = [];
  const { data: entries } = await admin
    .from('entries')
    .select('id, entry_date, project_id, transcript_raw, status, project:projects!inner(name)')
    .eq('status', 'draft')
    .not('transcript_raw', 'is', null)
    .limit(10);

  for (const entry of (entries ?? []) as Array<Record<string, unknown>>) {
    const { extractEntry } = await import('@/lib/extraction/extract');
    const { reconcileSections } = await import('@/lib/extraction/completeness');
    const { PROMPT_VERSION } = await import('@/lib/extraction/prompt');
    const { createHash } = await import('node:crypto');

    const { data: pending } = await admin
      .from('entry_extractions')
      .select('id, prompt_version')
      .eq('entry_id', entry.id as string)
      .eq('status', 'pending')
      .maybeSingle();

    // A proposal built by a superseded prompt is stale by definition — showing
    // it to a supervisor means showing a worse extraction than the system can
    // now produce, and they would be signing off the older one's mistakes.
    // Nothing is lost: the old proposal is kept as superseded.
    const stale = pending != null && pending.prompt_version !== PROMPT_VERSION;
    if (pending && !stale) continue;

    try {
      if (stale) {
        await admin
          .from('entry_extractions')
          .update({ status: 'superseded' })
          .eq('id', pending.id as string);
      }

      const transcript = (entry.transcript_raw as string).trim();
      const { data: terms } = await admin.rpc('project_keyterms', {
        p_project_id: entry.project_id as string,
      });
      const project = Array.isArray(entry.project) ? entry.project[0] : entry.project;

      const result = await extractEntry({
        transcript,
        entryDate: entry.entry_date as string,
        projectName: (project as { name: string } | null)?.name ?? null,
        vocabulary: (terms as string[] | null) ?? [],
      });
      // The same pipeline as /api/entries/[id]/extract, or the same words
      // would land differently depending on which path reached them first:
      // reconcile → the project's crew and plant lists → the standard day.
      const { applyStandardDay } = await import('@/lib/extraction/completeness');
      const { applyKnownNames } = await import('@/lib/extraction/known-names');
      const [{ data: crewRows }, { data: plantRows }] = await Promise.all([
        admin.from('crew').select('name, role, aliases').eq('project_id', entry.project_id as string).eq('active', true),
        admin.from('plant_list').select('item, hire_type, supplier, aliases').eq('project_id', entry.project_id as string).eq('active', true),
      ]);
      const { proposal: named } = applyKnownNames(
        reconcileSections(result.proposal).proposal,
        ((crewRows ?? []) as Array<{ name: string; role: string | null; aliases: string[] | null }>).map((c) => ({
          name: c.name, role: c.role, aliases: c.aliases ?? [],
        })),
        ((plantRows ?? []) as Array<{ item: string; hire_type: string | null; supplier: string | null; aliases: string[] | null }>).map((m) => ({
          item: m.item, hire_type: m.hire_type as 'wet' | 'dry' | null, supplier: m.supplier, aliases: m.aliases ?? [],
        })),
      );
      const { proposal } = applyStandardDay(named);

      const { error } = await admin.from('entry_extractions').insert({
        entry_id: entry.id as string,
        status: 'pending',
        model: result.model,
        prompt_version: result.promptVersion,
        transcript_sha256: createHash('sha256').update(transcript, 'utf8').digest('hex'),
        proposal,
        raw_response: result.raw as object,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
      });

      extracted.push({
        entry: entry.id,
        ok: !error,
        reason: stale ? `re-extracted: was ${pending?.prompt_version}` : 'first extraction',
        prompt: result.promptVersion,
        ...(error ? { error: error.message } : {}),
      });
    } catch (error) {
      extracted.push({
        entry: entry.id,
        ok: false,
        error: error instanceof Error ? error.message.slice(0, 200) : String(error),
      });
    }
  }

  return { segments: transcribed, extractions: extracted };
}

async function probeBrowser() {
  const started = Date.now();
  try {
    const { renderDailyPdf } = await import('@/lib/pdf/render');
    // A minimal entry is enough: this is asking whether Chromium starts and
    // lays out a page at all, not whether the docket is right.
    const pdf = await renderDailyPdf({
      entry: {
        id: 'probe', entry_no: 'PROBE', entry_date: '2026-01-01', status: 'draft',
        signed_at: null, content_hash: null, supersedes_entry_id: null, notes: null,
        supersedes_entry_no: null, project_id: 'probe', org_name: 'Probe', org_code: 'PRB',
        project_name: 'Probe', project_code: 'P001', principal_contractor: null,
        author_name: 'Probe', labour: [], plant: [], work_items: [], variations: [], signatures: [],
        delays: [], pours: [], quantities: [], dayworks: [], photos: [], weather: null, sections: {},
      },
      photos: [],
    });
    return { ok: true, bytes: pdf.length, ms: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Mid-afternoon, every day: every active job's last nine days of site weather,
 * from the Bureau's daily table and the live gauge. Runs after the Bureau
 * re-issues the table (~06:30 GMT), so yesterday's max, min and rain are
 * settled figures by the time anyone looks on Monday — whether or not a diary
 * was written that day.
 */
async function refreshWeatherDays(): Promise<Record<string, unknown>> {
  const { perthToday } = await import('@/lib/push/decide');
  const admin = createAdminClient();
  const { data: projects } = await admin
    .from('projects')
    .select('id, site_lat, site_lng, bom_station_id, bom_product_id')
    .eq('active', true);
  const to = perthToday();
  const since = new Date(`${to}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - 8);
  const from = since.toISOString().slice(0, 10);

  const out: Record<string, unknown> = { from, to };
  for (const project of (projects ?? []) as ProjectSite[]) {
    const outcome = await refreshProjectWeatherDays(project, from, to);
    out[project.id] = outcome.ok
      ? `${outcome.days} days · ${outcome.station} · ${outcome.dailyMonths} table month(s)`
      : outcome.reason;
  }
  return out;
}
