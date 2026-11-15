/**
 * A full page load (not a client-side transition). Used when the signed-in person changes
 * (demo role switch, sign-out), so that no part of the old session's page, header or cache survives.
 */
export function fullPageLoad(path: string) {
  window.location.assign(new URL(path, window.location.origin).toString());
}
