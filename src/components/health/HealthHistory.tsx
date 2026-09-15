"use client";

import { useState, useTransition } from "react";
import { clearDay, deleteWalk } from "@/lib/health-actions";
import type { HealthSnapshot } from "@/lib/health-store";

/**
 * What has actually been done, most recent first.
 *
 * The standalone app put this in a month grid with a day-detail rail. That was a
 * whole screen; this is a column on a board that already has a calendar in the
 * middle of it, so the list is the honest version — and the sessions are on the
 * calendar anyway, under the heart.
 */
export function HealthHistory({
  snapshot,
  writable,
  onBack,
}: {
  snapshot: HealthSnapshot;
  writable: boolean;
  onBack: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const remove = (row: (typeof snapshot.recent)[number]) => {
    startTransition(async () => {
      const result = row.walkId ? await deleteWalk(row.walkId) : await clearDay(row.date);
      if (!result.ok) setError(result.error ?? "That didn't save.");
    });
  };

  return (
    <>
      <p className="health-eyebrow">History</p>
      <h3 className="healthcard-title">The last two weeks</h3>
      {error && <p className="healthnote is-error">{error}</p>}

      {snapshot.recent.length === 0 ? (
        <p className="empty">Nothing logged yet. The first one is the hard one.</p>
      ) : (
        <ul className="healthlist healthlist-history">
          {snapshot.recent.map((row) => (
            <li key={row.key} className={pending ? "is-pending" : ""}>
              <span className="healthlist-when mono">{row.date.slice(5)}</span>
              <span className="healthlist-what">
                {row.title}
                {row.feedback && <span className="healthchip">{row.feedback.replace("_", " ")}</span>}
              </span>
              <span className="mono">{row.minutes}m</span>
              <button type="button" className="healthlink" disabled={!writable || pending} onClick={() => remove(row)}>
                remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <section className="healthblock">
        <p className="health-eyebrow">Where each movement is right now</p>
        <ul className="healthladders">
          {snapshot.ladders.map((row) => (
            <li key={row.patternId}>
              <span className="healthladder-label">{row.label}</span>
              <span className="healthladder-rung">
                {row.rung}
                <span className="mono healthladder-count">
                  {row.shown + 1}/{row.total}
                  {row.capped ? " · held by phase" : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="healthfoot">
        <button type="button" className="healthbtn is-quiet" onClick={onBack}>
          Back
        </button>
      </div>
    </>
  );
}
