export function canRecoverProviderAction(state: string): boolean {
  return state === "FAILED" || state === "MANUAL_REVIEW";
}
