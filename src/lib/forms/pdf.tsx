import type { ReactElement } from 'react';
import { LOGO_DATA_URI } from '@/lib/pdf/logo';
import { fmtDate, fmtPerthDate } from '@/lib/pdf/dates';
import { answered, answerFails, answerText, type FormSpec, type Answers } from './model';

export interface FormPdfData {
  orgName: string; orgCode: string; projectName: string; projectCode: string;
  code: string; revision: string; title: string; basis: string | null; subjectLine: string | null;
  header: Array<{ label: string; value: string }>;
  spec: FormSpec; answers: Answers; photos: Record<string, Array<{ src: string }>>;
  status: string; outcome: string | null; score: number | null; passMark: number | null;
  completedBy: string; completedAwst: string; voided: string | null;
  ncs: Array<{ label: string; answer: string | null; status: string; action: string | null; owner: string | null; due: string | null; resolution: string | null; removed_reason: string | null; resolved_at: string | null }>;
  signature: string | null; printedAwst: string;
}

/** A completed form as it was filled (README R180): every question, its answer, the fails, the non-compliances, the signature. */
export function FormDoc({ data }: { data: FormPdfData }): ReactElement {
  const withPhotos = Object.entries(data.photos).filter(([, p]) => p.length > 0);
  const labelOf = (key: string) => data.spec.sections.flatMap((s) => s.questions).find((q) => q.key === key)?.label ?? key;
  return (
    <div className="docket form-doc">
      <header className="head">
        <div className="head__left">
          <p className="lbl"><img className="brandmark" src={LOGO_DATA_URI} alt="" /> {data.orgName}</p>
          <h1>{data.title}</h1>
          <p className="mono sub">{data.projectName} · {data.orgCode}_{data.projectCode} · {data.code} rev {data.revision}</p>
        </div>
        <div className="head__right">
          <p className="lbl">{data.voided ? 'VOIDED' : data.outcome === 'fail' ? 'FAIL' : 'PASS'}</p>
          <p className="mono big">{data.score != null ? `${data.score}%${data.passMark != null ? ` / ${data.passMark}%` : ''}` : '—'}</p>
          <p className="mono small">{data.completedBy} · {data.completedAwst}</p>
          {data.subjectLine && <p className="mono small">{data.subjectLine}</p>}
        </div>
      </header>
      {data.voided && <p className="src vr-missing">Voided: {data.voided}. The form stays on the file as it was completed.</p>}
      {data.basis && <p className="src">{data.basis}</p>}
      {data.header.length > 0 && (
        <section className="sect"><p className="lbl">Header</p>
          <table><tbody>{data.header.map((h) => <tr key={h.label}><td className="w">{h.label}</td><td className="mono">{h.value}</td></tr>)}</tbody></table>
        </section>
      )}
      {data.spec.sections.map((s, i) => (
        <section key={i} className="sect">
          <p className="lbl">{s.title}</p>
          <table>
            <thead><tr><th className="w">Question</th><th>Answer</th><th className="w">Note</th></tr></thead>
            <tbody>
              {s.questions.map((q) => {
                const a = data.answers[q.key];
                const fail = answerFails(q, a);
                return (
                  <tr key={q.key}>
                    <td className="w">{q.label}</td>
                    <td className={`mono${fail ? ' vr-missing' : ''}`}>{answered(q, a) ? answerText(q, a) : 'NOT ANSWERED'}</td>
                    <td className="w">{a?.note ?? ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}
      <section className="sect">
        <p className="lbl">Non-compliances</p>
        {data.ncs.length === 0 ? <p className="nil">No failing answers</p> : (
          <table>
            <thead><tr><th className="w">Question</th><th>Answer</th><th>Status</th><th className="w">Action / resolution</th></tr></thead>
            <tbody>
              {data.ncs.map((n, i) => (
                <tr key={i}>
                  <td className="w">{n.label}</td>
                  <td className="mono">{n.answer ?? '—'}</td>
                  <td className={`mono${n.status === 'open' ? ' vr-missing' : ''}`}>{n.status.toUpperCase()}{n.resolved_at ? ` ${fmtPerthDate(n.resolved_at)}` : ''}</td>
                  <td className="w">{n.action ? `${n.action}${n.owner ? ` → ${n.owner}` : ''}${n.due ? ` · due ${fmtDate(n.due)}` : ''}` : ''}{n.resolution ? ` — ${n.resolution}` : ''}{n.removed_reason ? ` — removed: ${n.removed_reason}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="sect sig">
        <p className="lbl">Completed</p>
        {data.signature ? (
          <div className="sig__drawn"><figure><img src={data.signature} alt="" style={{ height: '18mm' }} /><figcaption>{data.completedBy} · {data.completedAwst}</figcaption></figure></div>
        ) : <p className="nil">{data.completedBy} · {data.completedAwst} · no signature on this form</p>}
        <p className="src">Printed {data.printedAwst}. The answers are frozen at completion; non-compliances are worked afterwards.</p>
      </section>
      {withPhotos.length > 0 && (
        <section className="sect photos">
          <p className="lbl">Photographs</p>
          <div className="photos__grid">
            {withPhotos.flatMap(([key, ps]) => ps.map((p, n) => (
              <figure key={`${key}-${n}`}><img src={p.src} alt="" data-shrink="1200" /><figcaption className="mono">{labelOf(key).slice(0, 60)}</figcaption></figure>
            )))}
          </div>
        </section>
      )}
    </div>
  );
}

export const FORM_CSS = `
.form-doc .head__right .big { font-size: 13pt; font-weight: 700; margin: 0.5mm 0 0; }
.form-doc .head__right .small { font-size: 7.5pt; color: #5A6469; margin: 0.5mm 0 0; }
.form-doc td.vr-missing, .form-doc .src.vr-missing { color: #9A2B2B; font-weight: 700; }
`;
