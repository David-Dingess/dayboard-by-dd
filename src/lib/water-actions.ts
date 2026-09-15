"use server";

import { revalidatePath } from "next/cache";
import { todoGate, type TodoResult } from "./todo-actions";
import { applyDrink, applyGoal, loadWater, saveWater } from "./water";
import { todayLocal } from "./time";

/**
 * The two writes behind the bottle. Same gate as every other write on this
 * board — `todoGate` imported rather than copied, so "is this request from this
 * machine" stays one fact.
 */

/** The sizes on the desk: a cup, a glass, and the big bottle. */
const MAX_ONE_GO = 200;

export async function drinkWater(ounces: number): Promise<TodoResult> {
  if (!Number.isInteger(ounces) || ounces === 0 || Math.abs(ounces) > MAX_ONE_GO) {
    return { ok: false, error: "That is not a sensible amount." };
  }
  const gate = await todoGate();
  if (!gate.ok) return { ok: false, error: gate.reason };
  try {
    saveWater(applyDrink(loadWater(), todayLocal(), ounces));
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function setWaterGoal(goalOz: number): Promise<TodoResult> {
  const gate = await todoGate();
  if (!gate.ok) return { ok: false, error: gate.reason };
  if (!Number.isInteger(goalOz) || goalOz < 8 || goalOz > 400) {
    return { ok: false, error: "A daily goal between 8 and 400 ounces, please." };
  }
  try {
    saveWater(applyGoal(loadWater(), goalOz));
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
