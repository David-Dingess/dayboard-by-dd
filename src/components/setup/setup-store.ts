"use client";

import { useSyncExternalStore } from "react";
import { isSection, SECTIONS, type SectionId } from "./sections-list";

export { isSection, SECTIONS, type SectionId };

/**
 * Whether the setup guide is open, and on which section — shared between the
 * guide itself, the gear that opens it, and anything else on the board that
 * wants to send you to a section (the weather widget's "set your location").
 *
 * Module scope rather than React state so it can be driven from outside the
 * tree, the same way Panel.tsx's tab store works. Nothing here persists: which
 * section you were on is not worth remembering across a reload.
 */

interface State {
  open: boolean;
  section: SectionId;
}

let state: State = { open: false, section: "welcome" };
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function openSetup(section?: SectionId) {
  state = { open: true, section: section ?? state.section };
  emit();
}

export function closeSetup() {
  state = { ...state, open: false };
  emit();
}

export function goToSection(section: SectionId) {
  state = { ...state, section };
  emit();
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

let seeded = false;

/**
 * Seed the store from the URL's `?setup=` BEFORE the first render, on both
 * sides. The server renders the guide open, so a deep link (and a headless
 * screenshot) shows it in the HTML rather than a frame after hydration, and
 * the client's first snapshot matches, so hydration stays quiet. Once only:
 * a later navigation must not reopen it.
 */
export function seedSetup(initial: SectionId | null): void {
  if (seeded || !initial) return;
  seeded = true;
  state = { open: true, section: initial };
}

export function useSetupState(initial: SectionId | null = null): State {
  const server: State = initial ? { open: true, section: initial } : { open: false, section: "welcome" };
  return useSyncExternalStore(subscribe, () => state, () => server);
}
