import { useState } from "react";
import { CircleCheck, Clock3, Loader2, RefreshCw } from "lucide-react";
import { useStore } from "@/state/store";
import { organizationName } from "@/lib/brand";
import { engineReady } from "./EngineLibrary";

export function HitekServiceStatus() {
  const { state, refreshInstances } = useStore();
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const available = state.connected && state.instances.some(engineReady);
  const organization = organizationName();
  const check = async () => {
    setChecking(true);
    setFailed(false);
    try { await refreshInstances(); } catch { setFailed(true); }
    finally { setChecking(false); }
  };
  return <section data-hitek-service className="min-w-0 py-4" aria-label={`${organization} AI service`}>
    <div className="flex items-center gap-3">
      {available ? <CircleCheck size={18} className="shrink-0 text-success" /> : <Clock3 size={18} className="shrink-0 text-ink-secondary" />}
      <div className="min-w-0 flex-1">
        <h3 className="text-[14px] font-semibold text-ink">{organization} AI</h3>
        <p className="text-[13px] text-ink-secondary">{available ? `Configured by ${organization}` : "Awaiting service activation"}</p>
      </div>
      <button type="button" onClick={() => void check()} disabled={checking} aria-label="Check AI service" title="Check AI service" className="rounded-md p-2 text-ink-secondary hover:bg-raised disabled:opacity-50">
        {checking ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
      </button>
    </div>
    {!available && <p className="mt-2 text-[13px] leading-relaxed text-ink-secondary">AI is not available yet. {organization} manages activation; no personal AI account or key is needed.</p>}
    {failed && <p role="alert" className="mt-2 text-[13px] text-danger">Could not check the service. Try again.</p>}
  </section>;
}
