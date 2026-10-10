/** true when the app runs on sample data: no token, no network, no cost. */
export function isDemo(): boolean {
  return process.env.WARM_DEMO === "1";
}
