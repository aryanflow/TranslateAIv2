/** First 8 hex chars of a UUID (no dashes) for compact, unique download names. */
export function shortJobIdForDownload(jobId: string): string {
  return jobId.replace(/-/g, "").slice(0, 8).toLowerCase();
}

/**
 * Inserts the short job id before the final extension.
 * `catalog.xml` → `catalog.a1b2c3d4.xml` · `report.csv` → `report.a1b2c3d4.csv`
 */
export function withShortJobIdInFilename(filename: string, jobId: string): string {
  const tag = shortJobIdForDownload(jobId);
  if (!tag) return filename;
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot >= filename.length - 1) {
    return `${filename}.${tag}`;
  }
  return `${filename.slice(0, dot)}.${tag}${filename.slice(dot)}`;
}
