import { applyDrink, applyGoal, buildWaterSnapshot, loadWater, saveWater } from "../src/lib/water";
import { todayLocal } from "../src/lib/time";
import { notifyBoard } from "./notify-board";

/**
 * Water from a terminal or a chat session.
 *
 *   npm run water                     today, the goal and the streak
 *   npm run water -- drink 16         log ounces (a negative number takes some back)
 *   npm run water -- goal 80          change the daily target
 *
 * Same code path as the buttons: both call applyDrink and the same atomic save.
 */

const argv = process.argv.slice(2);
const command = argv[0] ?? "status";

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

const file = loadWater();
const today = todayLocal();

if (command === "status") {
  const s = buildWaterSnapshot(file, today);
  console.log(`${s.ounces} of ${s.goalOz} oz today (${Math.round(s.fill * 100)}%)`);
  console.log(`streak ${s.streak} day(s) at goal`);
  console.log("  " + s.week.map((d) => `${d.short}${d.met ? "*" : ""} ${d.ounces}`).join("  "));
} else if (command === "drink") {
  const oz = Number(argv[1] ?? die("Usage: npm run water -- drink 16"));
  if (!Number.isInteger(oz) || oz === 0) die("Ounces, as a whole number.");
  saveWater(applyDrink(file, today, oz));
  console.log(`${oz > 0 ? "logged" : "took back"} ${Math.abs(oz)} oz — ${loadWater().days[today] ?? 0} today`);
} else if (command === "goal") {
  const goal = Number(argv[1] ?? die("Usage: npm run water -- goal 80"));
  if (!Number.isInteger(goal) || goal < 8 || goal > 400) die("A goal between 8 and 400 ounces.");
  saveWater(applyGoal(file, goal));
  console.log(`daily goal is now ${goal} oz`);
} else {
  die('Usage: npm run water [-- drink <oz> | -- goal <oz>]');
}

// `status` only read; drink and goal both wrote. Ping the board to pull it now.
if (command !== "status") notifyBoard();
