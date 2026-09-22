/**
 * What a page looks like while it is still on its way (README R94). Next
 * draws this the instant a route is asked for and swaps the page in when it
 * arrives, so a slow connection shows a page taking shape rather than the
 * last screen sitting still. No numbers, no words that could be mistaken
 * for the record — grey bars and "Loading…".
 */
export default function Loading() {
  return (
    <main className="sheet page-skeleton" aria-busy="true" aria-live="polite">
      <p className="label">Kooboolong IMS</p>
      <div aria-hidden>
        <span className="page-skeleton__bar page-skeleton__bar--title" />
        <span className="page-skeleton__bar" />
        <span className="page-skeleton__bar page-skeleton__bar--short" />
        <span className="page-skeleton__block" />
        <span className="page-skeleton__block page-skeleton__block--short" />
        <span className="page-skeleton__bar page-skeleton__bar--short" />
      </div>
      <p className="caption page-skeleton__note"><span className="navpill__spin" aria-hidden>↻</span> Loading…</p>
    </main>
  );
}
