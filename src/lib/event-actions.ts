"use server";

import { revalidatePath } from "next/cache";
import { todoGate, type TodoResult } from "./todo-actions";
import {
  applyAddEvent,
  applyEditEvent,
  applyRemoveEvent,
  buildCuratedEvent,
  loadLayerFile,
  resolveMaster,
  saveLayerFile,
  writableLayers,
} from "./events-store";
import { EventInputSchema } from "./schema";

/**
 * Adding, editing and deleting an event from the board.
 *
 * `todoGate` again, imported rather than copied — "did this request come from
 * this machine" is one fact about the deployment. On a remote host every one of these
 * refuses and the editor renders read-only, which is right: the calendar there
 * is a copy of a file in git, and a write would be lost on the next deploy
 * even if it succeeded.
 *
 * ONLY CURATED EVENTS ARE EDITABLE. A fixture comes from a feed and is rewritten
 * wholesale by the refresh routine; a subscribed event lives in iCloud. Editing
 * either here would produce a change that silently disappears, which is worse
 * than not offering it — so the action checks `source.kind` rather than trusting
 * the UI to have hidden the button.
 */

export interface EventResult extends TodoResult {
  /** Where the calendar should go afterwards — the stored event's own id. */
  id?: string;
}

async function apply(mutate: () => string): Promise<EventResult> {
  const gate = await todoGate();
  if (!gate.ok) return { ok: false, error: gate.reason };
  let id: string;
  try {
    id = mutate();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath("/");
  // The single-event page reads the same files; without this an edit made from
  // the calendar would still show its old details when opened.
  revalidatePath("/event/[id]", "page");
  return { ok: true, id };
}

/**
 * Save one event: a new one when `editId` is absent, otherwise a change to the
 * series that id belongs to.
 *
 * AN INSTANCE EDITS ITS MASTER. `resolveMaster` turns "…@2026-10-14" back into
 * the stored row, because there is only one row — an occurrence is arithmetic,
 * not a record, so "edit this Tuesday only" is not a thing this can honour and
 * pretending otherwise would quietly change every Tuesday.
 */
export async function saveEvent(input: unknown, editId?: string): Promise<EventResult> {
  const parsed = EventInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That didn't look right." };
  }
  const data = parsed.data;

  if (!writableLayers().includes(data.layer)) {
    return { ok: false, error: `${data.layer} is not a layer this board can write to.` };
  }

  return apply(() => {
    const now = new Date().toISOString();

    if (!editId) {
      const event = buildCuratedEvent(data, now);
      saveLayerFile(data.layer, applyAddEvent(loadLayerFile(data.layer), event));
      return event.id;
    }

    const id = resolveMaster(editId);
    // Find it in the layer it is stored in, which is not necessarily the layer
    // the form now says: moving an event between layers is a delete and an add,
    // because the id carries the layer in it.
    const from = writableLayers().find((layer) => loadLayerFile(layer).some((e) => e.id === id));
    if (!from) throw new Error("That event is not one this board stores.");

    const existing = loadLayerFile(from).find((e) => e.id === id)!;
    if (existing.source.kind !== "curated") {
      throw new Error("That event comes from a feed, so this board cannot change it.");
    }

    const rebuilt = buildCuratedEvent(data, now, id);

    if (from !== data.layer) {
      saveLayerFile(from, applyRemoveEvent(loadLayerFile(from), id));
      saveLayerFile(
        data.layer,
        applyAddEvent(loadLayerFile(data.layer), { ...rebuilt, seq: existing.seq + 1 }),
      );
      return id;
    }

    saveLayerFile(
      from,
      applyEditEvent(
        loadLayerFile(from),
        id,
        {
          title: rebuilt.title,
          start: rebuilt.start,
          end: rebuilt.end,
          allDay: rebuilt.allDay,
          location: rebuilt.location,
          url: rebuilt.url,
          notes: rebuilt.notes,
          status: rebuilt.status,
          recurrence: rebuilt.recurrence,
        },
        now,
      ),
    );
    return id;
  });
}

export async function removeEvent(id: string): Promise<EventResult> {
  return apply(() => {
    const master = resolveMaster(id);
    const from = writableLayers().find((layer) => loadLayerFile(layer).some((e) => e.id === master));
    if (!from) throw new Error("That event is not one this board stores.");
    saveLayerFile(from, applyRemoveEvent(loadLayerFile(from), master));
    return master;
  });
}
