/**
 * The pet on the shelf.
 *
 * Sprite strips derived from OpenPets' v2.5.1 default pet, which is MIT with no
 * carve-out for artwork — see public/pets/LICENSE-openpets.txt for the notice
 * that licence requires and for exactly what was changed. It replaced a
 * hand-recoloured cat from the `pixel-buddy` pack, which was legally fine and
 * looked it; this is an eight-frame walk cycle drawn by someone who can draw.
 *
 * NOT clawd's artwork, despite what the files are called — that set is All
 * Rights Reserved fan art and may not be copied. These are OpenPets' own
 * sprites of their own character, which happens to be a similar orange
 * creature. OpenPets themselves replaced it with an owl after v2.5.1.
 *
 * THE ANIMATION LIVES IN CSS, not here. globals.css keys the strip, the frame
 * count and the tempo off the shelf's data-state; this module exists only to
 * name the three states the agent can distinguish. Which of the source sheet's
 * nine animations each state gets:
 *
 *   working  -> row 2, an eight-frame walk cycle with the legs actually moving
 *   waiting  -> row 3, a wave, which is what "needs your OK" looks like
 *   chilling -> row 5, asleep, with a little sparkle
 */

export type CatState = "working" | "waiting" | "chilling";
