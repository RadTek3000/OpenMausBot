import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowRight, CircleCheck, Loader2, X } from "lucide-react";
import { brand, organizationName } from "@/lib/brand";
import { completionPatch, hintSeen, hintSeenPatch, showWelcome, type WelcomeViewer } from "@/lib/onboarding";
import { api, useStore } from "@/state/store";
import { engineReady } from "../EngineLibrary";
import { HitekServiceStatus } from "../HitekServiceStatus";
import { McpServersPanel } from "../McpServersPanel";

export const HITEK_WELCOME_HINT = "hitek-welcome-v1";

export function HitekWelcome({ viewer, onDone }: { viewer: WelcomeViewer; onDone: () => void }) {
  const { state, dispatch } = useStore();
  const [crmReady, setCrmReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const ready = state.connected && state.instances.some(engineReady) && crmReady;
  useEffect(() => showWelcome(), []);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);

  const finish = async () => {
    if (savingRef.current) return;
    if (!viewer.canSave || hintSeen(state.config?.onboarding, HITEK_WELCOME_HINT)) { onDone(); return; }
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const patch = hintSeenPatch(state.config?.onboarding, HITEK_WELCOME_HINT);
      const config = await api("/api/config", {
        method: "PUT",
        body: JSON.stringify({ onboarding: { ...completionPatch().onboarding, ...patch?.onboarding } }),
        timeoutMs: 10_000,
      });
      dispatch({ type: "configStatus", config });
      onDone();
    } catch {
      setError("Could not save your welcome progress. Please try again.");
    } finally { savingRef.current = false; setSaving(false); }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); if (!savingRef.current) onDone(); return; }
    if (event.key !== "Tab") return;
    const nodes = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]') ?? [])]
      .filter((node) => node.getClientRects().length > 0);
    const first = nodes[0], last = nodes.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  const appBrand = brand();
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-3 sm:p-6" data-hitek-welcome>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="hitek-welcome-title" tabIndex={-1} onKeyDown={onKeyDown}
      className="relative max-h-[calc(100dvh-24px)] w-full max-w-[560px] overflow-y-auto rounded-lg border border-hairline/50 bg-app p-5 text-ink shadow-xl outline-none sm:p-8">
      <button type="button" onClick={onDone} aria-label="Close welcome" title="Close welcome" disabled={saving} className="absolute right-3 top-3 rounded-md p-2 text-ink-secondary hover:bg-raised disabled:opacity-50"><X size={18} /></button>
      {appBrand.logo && <img src={appBrand.logo} alt={appBrand.name} className="mb-6 h-7 w-32 object-contain object-left" />}
      <h1 id="hitek-welcome-title" className="pr-4 text-[23px] font-semibold leading-tight">Welcome to {appBrand.name}</h1>
      <div className="mt-5 divide-y divide-hairline/40">
        <section className="flex items-center gap-3 py-4" aria-label="Signed-in account">
          <CircleCheck size={18} className="shrink-0 text-success" />
          <div className="min-w-0"><h3 className="text-[14px] font-semibold">Signed in</h3><p className="break-all text-[13px] text-ink-secondary">{viewer.email || `Your ${organizationName()} account`}</p></div>
        </section>
        <McpServersPanel hitekOnly onHitekConnection={setCrmReady} canConnect={viewer.canSave} />
        <HitekServiceStatus />
      </div>
      <div className="mt-4 border-t border-hairline/40 pt-5">
        {error && <p role="alert" className="mb-3 text-[13px] text-danger">{error}</p>}
        <p className="mb-4 text-[13px] leading-relaxed text-ink-secondary">{ready ? "Your first task: review new inquiries in your shop." : "You can explore your workspace while setup is completed. CRM tasks require both connections."}</p>
        <button type="button" disabled={saving} onClick={() => void finish()} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-2.5 text-[14px] font-medium text-accent-ink disabled:opacity-50">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
          {saving ? "Saving" : ready ? "Open workspace" : "Explore workspace"}
        </button>
      </div>
    </div>
  </div>;
}
