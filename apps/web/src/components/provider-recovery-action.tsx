import { ReconciliationActions } from "./admin-ops";
import { canRecoverProviderAction } from "../lib/provider-recovery";

export function ProviderRecoveryAction({ id, state }: { id: string; state: string }) {
  if (!canRecoverProviderAction(state)) return <span className="muted">In progress</span>;
  return <ReconciliationActions id={`provider-action:${id}`} kind="PROVIDER_ACTION" />;
}
