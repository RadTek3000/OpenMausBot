import { useOrganizationBranding } from "@/lib/use-organization-branding";
import { brand } from "@/lib/brand";

export function OrganizationIdentity({ compact = false }: { compact?: boolean }) {
  const organization = useOrganizationBranding();
  const identity = organization ?? brand();
  if (!identity.logo) return null;
  return <div className={`flex items-center gap-2 py-2 ${compact ? "justify-center px-1" : "px-4"}`} title={identity.name}>
    <img src={identity.logo} alt={`${identity.name} logo`} className={organization ? "size-8 shrink-0 rounded-lg object-contain" : "h-6 w-auto max-w-[112px] shrink-0 object-contain"} />
    {!compact && <span className="truncate text-[13px] font-semibold text-ink-secondary">{identity.name}</span>}
  </div>;
}
