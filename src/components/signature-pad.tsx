'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Ink on glass. A plain canvas driven by pointer events, so a finger, a
 * stylus and a mouse all draw; scaled by devicePixelRatio so the stroke is
 * crisp on the PDF, not just the screen. The pad hands back a PNG blob —
 * storage and the record are the caller's business.
 */
export function SignaturePad({
  disabled,
  onSave,
  saving,
}: {
  disabled?: boolean;
  saving?: boolean;
  onSave: (blob: Blob) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const context = canvas.getContext('2d');
    if (context) {
      context.scale(ratio, ratio);
      context.lineWidth = 2.25;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.strokeStyle = '#16211f';
    }
  }, []);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function down(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const context = canvasRef.current?.getContext('2d');
    const p = point(event);
    context?.beginPath();
    context?.moveTo(p.x, p.y);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    // Stop the page scrolling under the finger mid-signature.
    event.preventDefault();
    const context = canvasRef.current?.getContext('2d');
    const p = point(event);
    context?.lineTo(p.x, p.y);
    context?.stroke();
    setDirty(true);
  }

  function up() {
    drawing.current = false;
  }

  function clear() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    setDirty(false);
  }

  function save() {
    canvasRef.current?.toBlob((blob) => {
      if (blob) onSave(blob);
    }, 'image/png');
  }

  return (
    <div className="sigpad">
      <canvas
        ref={canvasRef}
        className="sigpad__canvas"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      <div className="sigpad__actions">
        <button type="button" className="quotebtn" onClick={clear} disabled={!dirty || saving}>
          Clear
        </button>
        <button
          type="button"
          className="button button--quiet"
          onClick={save}
          disabled={!dirty || disabled || saving}
        >
          {saving ? 'Saving…' : 'Save signature'}
        </button>
      </div>
    </div>
  );
}
