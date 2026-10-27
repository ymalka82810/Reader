/** foliate measures what is left in time units of 1,600 bytes of the book's source (SectionProgress in progress.js) */
const BYTES_PER_UNIT = 1600

const toMinutes = (units: number | undefined, secsPerKB: number): number | null =>
  units && units > 0 && secsPerKB > 0 ? Math.max(1, Math.round((units * BYTES_PER_UNIT * secsPerKB) / 1000 / 60)) : null

/**
 * Minutes left in the current section (chapter) and in the whole book, at `secsPerKB` (the reader's own pace, see
 * lib/pace). `time` is foliate's relocate estimate. The chapter is left out for a book that is one section.
 */
export function timeLeft(
  time: { section?: number; total?: number } | undefined,
  secsPerKB: number,
  sections: number,
): { chapter: number | null; book: number | null } {
  return {
    chapter: sections > 1 ? toMinutes(time?.section, secsPerKB) : null,
    book: toMinutes(time?.total, secsPerKB),
  }
}
