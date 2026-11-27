/**
 * "Resting on a table": a viewer-level boundary condition, NOT part of the shared physics spec
 * (the classification path — `simulate()` without options, `shapeMetric`, the lab agreement — never
 * uses it).
 *
 * The free relaxed solve has (almost) no stiffness against isometric bending, so a flat lace piece
 * with floppy chain loops and long thin arms can settle into a crumpled or folded local minimum
 * that no real piece lying on a table shows (review R1: the sim is over-sensitive). With this option
 * the piece is grown on a table: the plane z = z0 just below the first round as placed (growth starts in the xy-plane, physics.md §4),
 * with a weak uniform weight on every particle, potential `f · z`, and a stiff one-sided penalty
 * `½ k_t · min(0, z)²` that keeps it above the table. Floppy (zero-stiffness) modes lie down;
 * genuine cups and ruffles still rise off the table, because flattening them would stretch or
 * compress the fabric, which costs far more than the weight can pay (f is ~1/500 of a course
 * spring's stiffness per particle).
 */

/** Weight per particle (in spring-force units: k_course × strain). */
export const TABLE_GRAVITY = 0.002;
/** Stiffness of the table's one-sided penalty, per particle (1/mm). */
export const TABLE_STIFFNESS = 2;

export interface TableOptions {
  gravity?: number;
  stiffness?: number;
  /** Height of the table (mm). The grower sets it just below the first round as placed. */
  z0?: number;
}

/**
 * Add the table energy of the particles x (flat [3n], compact) to E and its gradient to g.
 * Returns the new energy.
 */
export function addTableEnergy(x: Float64Array, g: Float64Array, E: number, opts: TableOptions = {}): number {
  const f = opts.gravity ?? TABLE_GRAVITY, kt = opts.stiffness ?? TABLE_STIFFNESS, z0 = opts.z0 ?? 0;
  const n = x.length / 3;
  for (let q = 0; q < n; q++) {
    const z = x[3 * q + 2] - z0;
    E += f * z;
    let dz = f;
    if (z < 0) { E += 0.5 * kt * z * z; dz += kt * z; }
    g[3 * q + 2] += dz;
  }
  return E;
}
