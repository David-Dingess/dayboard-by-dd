"use server";

import { spawn } from "node:child_process";
import { todoGate } from "./todo-actions";

/**
 * Restarting the board from the board.
 *
 * WHY THIS IS NOT JUST location.reload(). A reload fixes a wedged browser — a
 * dead SSE, a React tree that has lost its way — and that is most of what goes
 * wrong. It cannot fix a wedged SERVER, which is the other half, and under
 * the scheduled-task setup (scripts/setup.ps1) the server is a scheduled task
 * that you have no terminal in front of.
 *
 * THE WORK IS A SECOND SCHEDULED TASK, AND THAT IS THE WHOLE TRICK. Restarting
 * the server kills the process running this action, so it cannot be the thing
 * that waits and starts it again. It hands the job to `dayboard-restart`
 * instead: Task Scheduler creates that process, owns it, and does not care that
 * whoever asked is about to die. The browser polls until the port answers.
 *
 * IT USED TO SPAWN POWERSHELL ITSELF AND THAT NEVER WORKED ONCE. The old shape
 * was `spawn("powershell.exe", …, { detached: true, stdio: "ignore" })`, which
 * gives the child no console — and powershell.exe requires one, so it was
 * created, executed nothing, and exited. Silently, because the handles were
 * ignored and nobody waited for the code. The button reported success, fell
 * through to a page reload, and looked for all the world like it had worked.
 * `schtasks /Run` is a short-lived console-free process, which is precisely the
 * kind this one can start.
 *
 * IT DEGRADES HONESTLY. Under `npm run dev` there is no `dayboard-server` task,
 * so this reports that and the client falls back to a hard reload — which is the
 * correct answer for a dev server anyway, since nothing is supervising it.
 *
 * THE ORDERING LIVES IN scripts/restart-server.ps1, NOT IN A STRING HERE.
 * Ending the task is not reliably enough — Microsoft's own reference for
 * `schtasks /End` sends you to TaskKill for anything the task started, so an
 * orphaned node can keep the port. That matters more than it sounds: `next
 * start` does not slide to the next free port the way `next dev` does (the retry
 * in start-server.js is gated on isDev), so a held port is process.exit(1) and a
 * dark board. And `schtasks /Run` is silently dropped while the task still reads
 * Running, which a fixed one-second sleep cannot guarantee. Waiting on real
 * state and reclaiming the port does not fit in an escaped -Command string, so
 * it is a script the deploy path shares.
 */

const TASK = "dayboard-server";

/**
 * The on-demand task that does the restarting. Registered without a trigger by
 * scripts/setup.ps1; its action is scripts/restart-server.ps1, which is
 * also what `npm run deploy` uses, so there is one restart ordering and not two.
 */
const RESTART_TASK = "dayboard-restart";

export interface ResetResult {
  ok: boolean;
  /** True when the server itself was restarted, not just the page. */
  restarted: boolean;
  reason: string;
}

export async function resetBoard(): Promise<ResetResult> {
  const gate = await todoGate();
  if (!gate.ok) return { ok: false, restarted: false, reason: gate.reason };

  // Probe the task that actually does the work, not the one being restarted:
  // under `npm run dev` neither exists, and reporting on the one we are about to
  // /Run is the honest check. schtasks exits non-zero when a task is missing.
  const exists = await new Promise<boolean>((resolve) => {
    const probe = spawn("schtasks", ["/Query", "/TN", RESTART_TASK], { windowsHide: true });
    probe.on("error", () => resolve(false));
    probe.on("close", (code) => resolve(code === 0));
  });

  if (!exists) {
    return {
      ok: true,
      restarted: false,
      reason: `No ${RESTART_TASK} task, so there is nothing supervising ${TASK} — reloading instead.`,
    };
  }

  // NOT detached, and the exit code is actually read.
  //
  // `schtasks /Run` only asks Task Scheduler to start the task and returns —
  // the process that does the restarting belongs to Task Scheduler, not to us,
  // so nothing here needs to outlive this request. That matters, because
  // `detached: true` with `stdio: "ignore"` leaves a console program with no
  // console: it is created, runs nothing and exits, which is exactly how the
  // previous two versions of this failed silently. Waiting for the code means a
  // failure can be reported instead of assumed.
  const code = await new Promise<number | null>((resolve) => {
    const run = spawn("schtasks", ["/Run", "/TN", RESTART_TASK], { windowsHide: true });
    run.on("error", () => resolve(null));
    run.on("close", (c) => resolve(c));
  });

  if (code !== 0) {
    return {
      ok: false,
      restarted: false,
      reason: `Could not start ${RESTART_TASK} (schtasks exited ${code ?? "with an error"}).`,
    };
  }

  return { ok: true, restarted: true, reason: "Restarting the board's server…" };
}
