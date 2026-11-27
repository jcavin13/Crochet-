// Wording of the 3D page's verdicts (kept apart from the page so it can be tested in node).
import type { RoundClass } from '@/core/flatness';
import { simConfig } from '@/core/params';

/**
 * Why the two models disagree. Review R1/R2: the sim is not the arbiter. The two models have
 * different sensitivity (the sim reacts to mismatches of a few percent, the count rule tolerates
 * ±tol), and the sim has no stuffing, collision or gravity, so its shape is a tendency, not a
 * verdict. Never tell the user to trust one over the other.
 */
export const SENSITIVITY_NOTE =
  `The two models have different sensitivity: the simulation already reacts to a mismatch of a few percent, while the count rule tolerates ±${Math.round(simConfig.flatness.tol * 100)} %, and the simulation has no stuffing, no gravity and no self-collision. Read the 3D shape as a tendency, not a verdict.`;

export function explainDisagreement(sim: 'flat' | 'cup' | 'ruffle', analytic: RoundClass): string | null {
  if (analytic === 'n/a') return 'The count rule does not apply here (rows, or a round with nothing to measure); the simulation is the only check, and it shows a tendency, not a verdict.';
  if (sim === analytic) return null;
  if (analytic === 'cup' && sim === 'ruffle') {
    return `The count rule sees too few stitches; in the simulation the short edge can first pull the piece out of plane so the edge waves before a cup forms. ${SENSITIVITY_NOTE}`;
  }
  if (analytic === 'ruffle' && sim === 'cup') {
    return `The count rule sees too many stitches. The simulation's shape measure calls a strongly ruffled piece that is deeper than it is wavy a cup, so look at the edge in the 3D view. ${SENSITIVITY_NOTE}`;
  }
  if (analytic === 'flat') {
    return `Each round is within the count rule's flat band, but the simulation adds stitch heights and lean, and lets small mismatches add up over rounds, enough to make the piece ${sim === 'cup' ? 'cup' : 'wave'} a little. ${SENSITIVITY_NOTE} Blocking usually removes a gentle ${sim === 'cup' ? 'cup' : 'ruffle'}.`;
  }
  if (sim === 'flat') {
    return `The count rule flags this round, but in the simulation the neighbouring rounds absorb the difference (or the piece is still small), so it stays within the simulation's flat band (A and W below ${simConfig.tau_flat}). ${SENSITIVITY_NOTE}`;
  }
  return `The count rule looks at one round at a time, the simulation at the whole piece. ${SENSITIVITY_NOTE}`;
}

/** The shape is closed or closing (an amigurumi-style 3D form): it relaxes like an empty bag without stuffing. */
export function closedShapeNote(rounds: { closing?: boolean; class: RoundClass }[], upto: number): string | null {
  const shown = rounds.slice(0, upto + 1);
  if (!shown.some((r) => r.closing)) return null;
  return 'This is a closed 3D form. The simulation has no stuffing, so the piece relaxes like an empty bag (flattened or bell-shaped), not into the stuffed shape.';
}

