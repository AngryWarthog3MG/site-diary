'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Tap a photograph, see it big (README R130). Wraps a screen; any image inside one of the app's photo grids opens in a
 * full-screen viewer with the rest of that grid beside it — arrows, keyboard or a swipe to move, Escape or Close to
 * leave, and a link to the file itself for a pinch-zoom in a new tab. Works off the page as drawn, so the docket
 * template (which must stay byte-identical as a PDF) is untouched: the viewer reads the grid, it does not change it.
 */
const GALLERY = '.photo-review-grid, .inline-photo-grid, .photos__grid, .photo-zoom-gallery';

interface Shot { src: string; caption: string }

export function PhotoZoom({ children }: { children: React.ReactNode }) {
  const [shots, setShots] = useState<Shot[]>([]);
  const [at, setAt] = useState<number | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const img = target?.closest?.('img') as HTMLImageElement | null;
      if (!img || !img.src || img.closest('.photo-zoom')) return;
      const gallery = img.closest(GALLERY);
      if (!gallery || img.closest('button, a')) return;
      const imgs = Array.from(gallery.querySelectorAll('img')).filter((i) => i.src);
      const index = imgs.indexOf(img);
      if (index < 0) return;
      e.preventDefault();
      e.stopPropagation();
      setShots(imgs.map((i) => ({ src: i.src, caption: (i.closest('figure')?.querySelector('figcaption')?.textContent ?? i.alt ?? '').replace(/\s+/g, ' ').trim() })));
      setAt(index);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  const close = useCallback(() => setAt(null), []);
  const step = useCallback((d: number) => setAt((i) => (i == null ? i : (i + d + shots.length) % shots.length)), [shots.length]);

  useEffect(() => {
    if (at == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [at, close, step]);

  const shot = at == null ? null : shots[at];
  // Drawn on the document itself, not inside the screen: nothing an ancestor sets — opacity, transforms, stacking — reaches it.
  const viewer = shot && typeof document !== 'undefined' ? createPortal(
        <div className="photo-zoom" role="dialog" aria-modal="true" aria-label="Photograph" onClick={close}
          onPointerDown={(e) => { swipe.current = { x: e.clientX, y: e.clientY }; }}
          onPointerUp={(e) => {
            const s = swipe.current; swipe.current = null;
            if (!s) return;
            const dx = e.clientX - s.x; const dy = e.clientY - s.y;
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { e.stopPropagation(); step(dx < 0 ? 1 : -1); }
          }}
        >
          <div className="photo-zoom__bar" onClick={(e) => e.stopPropagation()}>
            <span className="photo-zoom__count mono">{at! + 1} of {shots.length}</span>
            <a className="photo-zoom__open" href={shot.src} target="_blank" rel="noopener">Open full size</a>
            <button ref={closeRef} type="button" className="photo-zoom__close" onClick={close} aria-label="Close">×</button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="photo-zoom__img" src={shot.src} alt={shot.caption || 'Photograph'} onClick={(e) => e.stopPropagation()} />
          {shot.caption && <p className="photo-zoom__caption" onClick={(e) => e.stopPropagation()}>{shot.caption}</p>}
          {shots.length > 1 && (
            <>
              <button type="button" className="photo-zoom__nav photo-zoom__nav--prev" aria-label="Previous photo" onClick={(e) => { e.stopPropagation(); step(-1); }}>‹</button>
              <button type="button" className="photo-zoom__nav photo-zoom__nav--next" aria-label="Next photo" onClick={(e) => { e.stopPropagation(); step(1); }}>›</button>
            </>
          )}
        </div>,
        document.body,
      ) : null;
  return (
    <>
      {children}
      {viewer}
    </>
  );
}
