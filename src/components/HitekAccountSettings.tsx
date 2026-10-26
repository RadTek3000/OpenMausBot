import { useState } from "react";
import { LogOut, RotateCcw } from "lucide-react";
import { api, useStore } from "@/state/store";
import { organizationName } from "@/lib/brand";
import { HitekServiceStatus } from "./HitekServiceStatus";
import { McpServersPanel } from "./McpServersPanel";
import { useWelcomeViewer } from "./onboarding/WelcomeGate";

export function HitekAccountSettings() {
  const { dispatch } = useStore();
  const viewer = useWelcomeViewer();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  const signOut = async () => {
    setSigningOut(true);
    setError("");
    try {
      await api("/api/auth/logout", { method: "POST" });
      window.location.assign("/pair");
    } catch { setError("Could not sign out. Please try again."); setSigningOut(false); }
  };
  return <div className="divide-y divide-hairline/40" data-hitek-account>
    <section className="pb-4">
      <h3 className="text-[14px] font-semibold text-ink">{organizationName()} account</h3>
      <p className="mt-1 break-all text-[13px] text-ink-secondary">{viewer?.email || "Signed in"}</p>
    </section>
    <McpServersPanel hitekOnly canConnect={viewer?.canSave === true} />
    <HitekServiceStatus />
    <section className="flex flex-wrap gap-2 pt-4">
      <button type="button" className="ui-button" onClick={() => {
        dispatch({ type: "toggleAppSettings", open: false });
        dispatch({ type: "toggleWelcome", open: true });
      }}><RotateCcw size={14} /> Review welcome</button>
      <button type="button" className="ui-button" disabled={signingOut} onClick={() => void signOut()}><LogOut size={14} /> {signingOut ? "Signing out" : "Sign out"}</button>
      {error && <p role="alert" className="w-full text-[13px] text-danger">{error}</p>}
    </section>
  </div>;
}
