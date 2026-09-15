import { DateTime } from "luxon";
import { PackageList } from "@/components/PackageList";
import { inFlight, returnsClosingSoon, type PackagesFile } from "@/lib/packages";
import { zone } from "@/lib/time";

/**
 * What is on its way from Amazon.
 *
 * The agent in agent/amazon logs in once, reuses the saved session on a
 * schedule, and writes data/packages.json; this renders it. No credential
 * anywhere near the board — the same shape as Flights and Mail, for the same
 * reasons. The rows themselves are PackageList, which only adds opening one.
 *
 * OUT FOR DELIVERY IS THE ONE WORTH A GLANCE, so it pulses like a fresh video;
 * everything else is a quiet row. Delivered packages stay a few days so "did it
 * come?" has an answer on the board, and one whose return window is about to
 * close stays longer with an amber "Return by" — both decided on the agent's
 * side, so this renders what it is given in the order it is given.
 */

export function PackagesWidget({ file }: { file: PackagesFile | null }) {
  if (!file) {
    return (
      <div className="widget">
        <div className="widget-head">
          <h2 className="widget-title">Packages</h2>
        </div>
        <div className="widget-scroll">
          <p className="empty">
            No poll yet. Sign in once with <code>agent/amazon/run_login.cmd</code>, then start the{" "}
            <code>Dayboard Amazon</code> task or run <code>agent/amazon/run_poll.cmd</code>.
          </p>
        </div>
      </div>
    );
  }

  const coming = inFlight(file);
  const returns = returnsClosingSoon(file);
  const summary = [
    coming > 0 ? `${coming} on the way` : null,
    returns > 0 ? `${returns} return${returns === 1 ? "" : "s"} closing` : null,
    DateTime.fromISO(file.fetchedAt).setZone(zone()).toRelative(),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="widget">
      <div className="widget-head">
        <h2 className="widget-title">Packages</h2>
        <span className="widget-meta">{summary}</span>
      </div>

      <div className="widget-scroll">
        {file.packages.length === 0 ? (
          <p className="empty">Nothing on the way.</p>
        ) : (
          <PackageList packages={file.packages} />
        )}
      </div>
    </div>
  );
}
