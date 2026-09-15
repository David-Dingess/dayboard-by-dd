/**
 * The health and exercise warning, in one place.
 *
 * The Health tab, the setup guide and the READMEs all say this, and a warning
 * that is worded three ways is three warnings with three sets of gaps. The
 * READMEs carry the same text by hand (they cannot import); keep them in step
 * when this changes.
 *
 * WHY IT SAYS "CLAUDE" SO PLAINLY. The programme, every cue and every drawn
 * animation were written and illustrated by an AI model and reviewed by nobody
 * qualified. A reader deciding whether to trust a squat cue is owed that fact
 * before anything else, not after a paragraph of boilerplate.
 */

/** One line, for the foot of the Health tab where it is seen before every Start. */
export const HEALTH_WARNING_SHORT =
  "Written and drawn entirely by Claude, an AI — not by a doctor, a trainer, or this board's author. " +
  "Not medical advice. Check with a doctor before you start, stop if anything hurts, and use it at your own risk.";

/** The full note, paragraph by paragraph. */
export const HEALTH_WARNING_FULL: readonly string[] = [
  "The Health programme — the 52-week plan, every exercise, cue, set and rep scheme, the chair routine, the walk targets, " +
    "the eye break, the notes on why — and every drawn animation of it were written and illustrated entirely by Claude, " +
    "an AI model made by Anthropic. No doctor, physiotherapist, certified trainer or other qualified professional wrote, " +
    "reviewed or approved any of it, and neither did the author of Dayboard by DD. It may contain mistakes: a wrong cue, " +
    "an unsuitable progression, or an animation that shows a movement incorrectly.",
  "It is general information, not medical advice, and it is not a substitute for a qualified professional who knows " +
    "your health. Talk to a doctor before starting this or any exercise programme — especially if you are pregnant, " +
    "have a heart, lung, joint, back or other medical condition, take medication, are recovering from an injury or " +
    "surgery, or have not exercised in a while.",
  "Stop straight away if you feel pain, dizziness, faintness, chest pain or unusual shortness of breath, and get " +
    "medical help if it does not pass. The follow-along videos are other people's, hosted on YouTube; this project " +
    "did not make them and does not vouch for them.",
  "You use the Health tab entirely at your own risk. To the fullest extent the law allows, it is provided \"as is\", " +
    "without warranty of any kind, and neither the author nor any contributor is liable for any injury, loss or damage " +
    "arising from its use.",
];
