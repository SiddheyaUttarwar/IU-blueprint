// Fallback list — only used if the progress_units master fetch fails (e.g. offline).
// The Master of record is the `progress_units` table (see src/services/progressUnits.js).
export const COMMON_UNITS = [
  'Nos', 'm', 'ft', 'kg', 'ton', 'm²', 'sq.ft', 'm³', 'cft', 'litre', 'bag', 'roll', 'cum', 'brass',
];
