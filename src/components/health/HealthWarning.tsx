import { HEALTH_WARNING_FULL, HEALTH_WARNING_SHORT } from "@/lib/health/disclaimer";

/**
 * The warning at the foot of the Health tab.
 *
 * Always there, never dismissable: it sits under the Start buttons on the one
 * screen every session begins from, so it is in view each time rather than
 * once on a first run nobody remembers. Quiet type, because it is read on an
 * always-on display; the full note opens in place.
 */
export function HealthWarning() {
  return (
    <details className="healthwarning">
      <summary>
        <span className="health-eyebrow">Read first · </span>
        {HEALTH_WARNING_SHORT}
      </summary>
      {HEALTH_WARNING_FULL.map((paragraph) => (
        <p key={paragraph.slice(0, 32)}>{paragraph}</p>
      ))}
    </details>
  );
}
