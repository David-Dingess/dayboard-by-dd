/**
 * The pet.
 *
 * A bare div. Which strip to show, how many frames it has and how fast it runs
 * are ALL in globals.css, keyed off the shelf's data-state — see the .cat rules
 * there. Nothing is passed in as an inline style, and that is the correction to
 * the first version: the frame count reached CSS as a custom property and got
 * fed to steps(), which does not reliably accept a var(), so the animation
 * silently did nothing.
 *
 * It takes no props at all for the same reason: the state arrives as the data
 * attribute on the shelf, which is also what decides whether it walks — one
 * source of truth rather than two that can disagree.
 */
export function ClaudeCat() {
  return <div className="cat" aria-hidden="true" />;
}
