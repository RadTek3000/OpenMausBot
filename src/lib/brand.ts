export interface Brand {
  name: string;
  tagline?: string;
  assistantName?: string;
  cloudName?: string;
  accent?: string;
  accentBorder?: string;
  accentText?: string;
  logo?: string;
  favicon?: string;
  supportUrl?: string;
  portalOrigin?: string;
}

export interface BrandStatus {
  brand: Brand;
  source: "default" | "file";
  file: string;
  notice?: string;
}

export const DEFAULT_BRAND: Brand = {
  name: "HITEK Agent Desk",
  tagline: "AI operations for HITEK dealers",
  assistantName: "HITEK Agent",
  cloudName: "HITEK Cloud",
  accent: "#E51717",
  accentBorder: "#FF3B30",
  accentText: "#FF625C",
  logo: "/hitek-wordmark.svg",
  favicon: "/hitek-app-icon.svg",
};

let current: BrandStatus = { brand: DEFAULT_BRAND, source: "default", file: "" };

export function brand(): Brand {
  return current.brand;
}

export function brandStatus(): BrandStatus {
  return current;
}

export function assistantName(b: Brand = current.brand): string {
  return b.assistantName?.trim() || b.name.trim() || "Assistant";
}

export function cloudName(b: Brand = current.brand): string {
  return b.cloudName?.trim() || `${b.name.trim()} Cloud`;
}

/** Normalize legacy assistant labels when displaying messages saved before a rebrand. */
export function rebrandDisplayedText(text: string): string {
  const product = brand().name.trim() || DEFAULT_BRAND.name;
  const assistant = assistantName();
  const cloud = cloudName();
  return text
    .replaceAll("OpenMausBot Cloud", cloud)
    .replaceAll("MausBot Cloud", cloud)
    .replaceAll("OpenMausBot", product)
    .replaceAll("MausBot", assistant)
    .replace(/(?<![A-Za-z0-9_.-])openmausbot(?![A-Za-z0-9_.:\/-])/gi, product);
}

const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

export function luminance(hex: string): number {
  const m = HEX.exec(hex);
  if (!m) return 0;
  const channel = (h: string) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(m[1]) + 0.7152 * channel(m[2]) + 0.0722 * channel(m[3]);
}

export function accentInk(accent: string): string {
  // contrast vs white = 1.05 / (L + 0.05); vs black = (L + 0.05) / 0.05
  const l = luminance(accent);
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? "#ffffff" : "#111111";
}

export function brandVars(b: Brand): Record<string, string> {
  if (!b.accent || !HEX.test(b.accent)) return {};
  const border = b.accentBorder && HEX.test(b.accentBorder) ? b.accentBorder : b.accent;
  const text = b.accentText && HEX.test(b.accentText) ? b.accentText : b.accent;
  return {
    "--color-accent": b.accent,
    "--color-accent-border": border,
    "--color-focus": border,
    "--color-accent-text": text,
    "--color-accent-ink": accentInk(b.accent),
  };
}

export function iconType(href: string): string {
  const match = /^data:(image\/[a-z0-9.+-]+)/i.exec(href);
  return match ? match[1].toLowerCase() : "";
}

let defaultIcon: { href: string; type: string } | null = null;

function applyIcon(favicon: string | undefined): void {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  defaultIcon ??= { href: link.getAttribute("href") ?? "", type: link.getAttribute("type") ?? "" };
  const next = favicon ? { href: favicon, type: iconType(favicon) } : defaultIcon;
  link.setAttribute("href", next.href);
  if (next.type) link.setAttribute("type", next.type);
  else link.removeAttribute("type");
  let touch = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"][data-brand]');
  if (favicon) {
    if (!touch) {
      touch = document.createElement("link");
      touch.rel = "apple-touch-icon";
      touch.dataset.brand = "1";
      document.head.appendChild(touch);
    }
    touch.href = favicon;
  } else touch?.remove();
}

export function applyBrand(status: BrandStatus): void {
  current = status;
  if (typeof document === "undefined") return;
  document.title = status.brand.name;
  applyIcon(status.brand.favicon);
  const root = document.documentElement;
  for (const name of ["--color-accent", "--color-accent-border", "--color-focus", "--color-accent-text", "--color-accent-ink"]) {
    root.style.removeProperty(name);
  }
  for (const [name, value] of Object.entries(brandVars(status.brand))) root.style.setProperty(name, value);
}

function isBrandStatus(value: unknown): value is BrandStatus {
  if (!value || typeof value !== "object") return false;
  const v = Reflect.get(value, "brand");
  return Boolean(v) && typeof v === "object" && typeof Reflect.get(Object(v), "name") === "string";
}

export async function bootstrapBrand(fetchImpl: typeof fetch = fetch, timeoutMs = 1500): Promise<BrandStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl("/api/brand", { signal: controller.signal });
    if (!res.ok) return current;
    const body: unknown = await res.json();
    if (isBrandStatus(body)) applyBrand(body);
  } catch {
  } finally {
    clearTimeout(timer);
  }
  return current;
}
