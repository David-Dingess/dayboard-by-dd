import { WaterBottle } from "@/components/WaterBottle";
import { buildWaterSnapshot, loadWater } from "@/lib/water";
import { todoGate } from "@/lib/todo-actions";
import { todayLocal } from "@/lib/time";

/**
 * Water, between the call and the controls.
 *
 * The arithmetic — the fill, the streak, the week — is all done here so the
 * client component holds none of it and a refresh tick recomputes nothing.
 */
export async function WaterWidget() {
  const snapshot = buildWaterSnapshot(loadWater(), todayLocal());
  const gate = await todoGate();

  return (
    <div className="widget">
      <h2 className="stack-title">
        Water
        <span className="stack-meta">
          {snapshot.ounces >= snapshot.goalOz
            ? "done for today"
            : `${snapshot.goalOz - snapshot.ounces} oz to go`}
        </span>
      </h2>
      <div className="widget-scroll">
        <WaterBottle snapshot={snapshot} writable={gate.ok} reason={gate.reason} />
      </div>
    </div>
  );
}
