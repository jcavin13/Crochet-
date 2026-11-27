/**
 * Amigurumi tools: surfaces of revolution → round-by-round patterns, and gauge calculators.
 *
 *   revolve({ profile, params, stitch?, stagger?, repeat? })  → { text, rounds, realised, warnings, … }
 *   PRESETS / presetProfile(id, heightMm?)                     profiles as data (mm)
 *   sampleProfile / pointAt / scaleProfile                     profile geometry
 *   spreadEvenly / compressUnits / emitPattern                 round planning + notation output
 *   gaugeFromParams / paramsFromGauge / rectangle / circle / tube / hat / convertGauge
 */
export * from './profile';
export * from './rounds';
export * from './revolve';
export * from './gauge';
