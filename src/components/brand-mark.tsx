/**
 * The Kooboolong frog, one component for every screen header. The PDF
 * templates embed their own base64 copy (src/lib/pdf/logo.ts) because an
 * archival document never reaches for the network; screens can just ask for
 * the file.
 */
export function BrandMark({ size = 22, withName = false }: { size?: number; withName?: boolean }) {
  return (
    <span className="brandrow">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/frog.png"
        alt="Kooboolong Services"
        width={size}
        height={Math.round(size * 1.11)}
      />
      {withName && <span className="brandrow__name">KBS Daily Diary</span>}
    </span>
  );
}
