'use client';

import { useEffect, useRef } from 'react';

/**
 * Live waveform. Reads the level straight off the recorder's analyser each
 * frame rather than holding audio in React state — this runs for 90 seconds
 * on a phone that is also uploading.
 */
export function Waveform({
  getLevel,
  active,
  height = 72,
}: {
  getLevel: () => number;
  active: boolean;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelsRef = useRef<number[]>([]);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = height * dpr;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const BAR = 3;
    const GAP = 2;

    const draw = () => {
      const width = canvas.clientWidth;
      const capacity = Math.floor(width / (BAR + GAP));

      levelsRef.current.push(active ? getLevel() : 0);
      if (levelsRef.current.length > capacity) {
        levelsRef.current.splice(0, levelsRef.current.length - capacity);
      }

      const styles = getComputedStyle(canvas);
      context.clearRect(0, 0, width, height);
      context.fillStyle = active
        ? styles.getPropertyValue('--signal').trim() || '#b8341f'
        : styles.getPropertyValue('--ink-30').trim() || 'rgba(19,26,30,0.3)';

      levelsRef.current.forEach((level, index) => {
        const barHeight = Math.max(2, level * height);
        const x = index * (BAR + GAP);
        context.fillRect(x, (height - barHeight) / 2, BAR, barHeight);
      });

      frameRef.current = requestAnimationFrame(draw);
    };

    frameRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [active, getLevel, height]);

  return (
    <canvas
      ref={canvasRef}
      className="waveform"
      style={{ height }}
      aria-hidden="true"
    />
  );
}
