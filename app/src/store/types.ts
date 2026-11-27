import type { Pattern } from '@/app/coreApi';

export type PatternOrigin = 'fixture' | 'corpus' | 'user' | 'designer';

export type PatternRecord = {
  id: string;
  title: string;
  /** Notation (.cro) source. */
  text: string;
  createdAt: number;
  updatedAt: number;
  origin: PatternOrigin;
  /**
   * A graph imported from `.crochet.json` without notation. Used as the pattern until the text
   * is edited (editing clears it).
   */
  graph?: Pattern;
  /** Built-in records (fixtures, corpus) are read-only; duplicate them to edit. */
  readOnly?: boolean;
  /** Built-ins: file name stem, e.g. "simple_doily". */
  slug?: string;
};
