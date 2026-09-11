/**
 * The Glacier ground: two blurred radial gradients (purple top-left, green right) plus a faint
 * 48px gridline mask that fades out by 60% of the viewport. Fixed behind every page, painted once
 * in the root layout. Hidden entirely under prefers-reduced-transparency (see globals.css).
 */
export default function Aurora() {
  return (
    <div className="aurora-layer" aria-hidden="true">
      <span className="aurora-purple" />
      <span className="aurora-green" />
      <span className="gridlines" />
    </div>
  );
}
