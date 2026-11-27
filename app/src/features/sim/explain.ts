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


/** The words for a region's verdict ("waves", "puckers", "cups", "ruffles", "curls"). */
const REGION_VERB: Record<string, string> = { waves: 'waves', puckers: 'puckers', cup: 'cups', ruffle: 'ruffles', curling: 'curls' };

/**
 * One line for the per-region report of a piece with rows, a border or a polygon (core/sim
 * regionShape): "Lies flat: body, 4 sides and 4 corners." or "Left side waves · Top left corner
 * cups; the rest lies flat."
 */
export function regionsSentence(rep: { overall: string; body: { class: string }; sides: { label: string; class: string }[]; corners: { label: string; class: string }[] }): string {
  const parts = rep.sides.length || rep.corners.length;
  if (rep.overall === 'flat') {
    return parts ? `Lies flat: body, ${rep.sides.length} sides and ${rep.corners.length} corners.` : 'The rows lie flat.';
  }
  const bad: string[] = [];
  if (rep.body.class !== 'flat') bad.push(`the body ${REGION_VERB[rep.body.class] ?? rep.body.class}`);
  for (const s of rep.sides) if (s.class !== 'flat') bad.push(`${s.label} ${REGION_VERB[s.class] ?? s.class}`);
  for (const c of rep.corners) if (c.class !== 'flat') bad.push(`${c.label} corner ${REGION_VERB[c.class] ?? c.class}`);
  const s = bad.join(' · ');
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}; the rest lies flat.`;
}
