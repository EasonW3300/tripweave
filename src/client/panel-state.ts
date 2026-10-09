// The delivery card is a toggle; switching versions keeps the panel open.
export function togglePanel(openVersion: number | null, clickedVersion: number): number | null {
  return openVersion === clickedVersion ? null : clickedVersion;
}
