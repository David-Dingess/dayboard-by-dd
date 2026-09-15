import { HealthApp } from "@/components/health/HealthApp";
import { buildSnapshot, loadHealthVideos } from "@/lib/health-store";
import type { HealthFile } from "@/lib/schema";
import { todoGate } from "@/lib/todo-actions";
import { todayLocal } from "@/lib/time";

/**
 * Health: the 52-week program that used to be its own Windows app.
 *
 * Everything the tab draws is computed here, on the server, from one date key —
 * `todayLocal()` — and handed down as a plain object. Nothing in the snapshot
 * comes from `Date.now()`, so the markup the server sends is the markup the
 * browser would have made, and the parts that genuinely need the clock (the
 * session countdown, the nudge tick, the eye break) say so by being client
 * components with their own timers.
 *
 * The gate is read here to decide what the buttons look like, and again inside
 * every action, which is the check that counts — see todo-actions.ts. On a remote host
 * that means the tab reads correctly and writes nothing, which is the honest
 * state for a copy of the board that is not the machine you train in front of.
 */
export async function HealthWidget({ file }: { file: HealthFile }) {
  const snapshot = buildSnapshot(file, todayLocal(), loadHealthVideos());
  const gate = await todoGate();

  return (
    <div className="widget healthwidget">
      <div className="widget-head">
        <h2 className="widget-title">Health</h2>
        <span className="widget-meta">
          Week {snapshot.weekNumber} of 52 · Phase {snapshot.phase.index}, {snapshot.phase.name}
          {snapshot.session.isDeload ? " · deload" : ""}
          {snapshot.settings.paused ? " · paused" : ""}
        </span>
      </div>
      <HealthApp snapshot={snapshot} writable={gate.ok} reason={gate.reason} />
    </div>
  );
}
