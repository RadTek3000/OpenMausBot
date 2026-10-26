// White-label: a brand.json next to the data dir, applied only with the `whitelabel` entitlement (an unlicensed server
// reports what it found and keeps the default). Read on every request, so an edit shows on the next reload.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { DATA_DIR } from "./config.ts";
import { entitled } from "./enterprise.ts";
import { BRAND_DEFAULTS } from "../shared/brand-defaults.ts";

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;
const MAX_LOGO_CHARS = 300_000;
const MAX_FAVICON_CHARS = 120_000;

export const brandSchema = z
  .object({
    /** Product name shown in the window title, onboarding and settings. */
    name: z.string().trim().min(1, "name must not be empty").max(40, "name must be 40 characters or fewer"),
    /** Organization name used in managed-service labels. */
    organizationName: z.string().trim().min(1).max(40).optional(),
    /** One line under the name on the welcome screen. */
    tagline: z.string().trim().max(120, "tagline must be 120 characters or fewer").optional(),
    /** Name shown for the built-in assistant; separate so deployments can brand the product and assistant independently. */
    assistantName: z.string().trim().min(1, "assistantName must not be empty").max(40, "assistantName must be 40 characters or fewer").optional(),
    /** Name shown for hosted account and cloud surfaces. */
    cloudName: z.string().trim().min(1, "cloudName must not be empty").max(40, "cloudName must be 40 characters or fewer").optional(),
    /** Accent colour for buttons, links and focus rings; text on it is derived for contrast. */
    accent: z.string().regex(HEX_COLOUR, "accent must be a 6-digit hex colour such as #C2510A").optional(),
    /** Optional brighter tones for borders and text when the base accent is used on a dark skin. */
    accentBorder: z.string().regex(HEX_COLOUR, "accentBorder must be a 6-digit hex colour").optional(),
    accentText: z.string().regex(HEX_COLOUR, "accentText must be a 6-digit hex colour").optional(),
    /** Welcome-screen mark: an inline data:image/... URI or an https:// URL. */
    logo: z
      .string()
      .max(MAX_LOGO_CHARS, `logo must be under ${MAX_LOGO_CHARS} characters (inline a small SVG or link an https:// image)`)
      .refine((v) => v.startsWith("data:image/") || v.startsWith("https://"), "logo must be a data:image/... URI or an https:// URL")
      .optional(),
    /** Where "get help" points for this deployment. */
    supportUrl: z.string().url().startsWith("https://", "supportUrl must be an https:// URL").optional(),
    /** Organization sign-in origin for this deployment; supplied by the host rather than embedded in the client. */
    portalOrigin: z.string().url().startsWith("https://", "portalOrigin must be an https:// URL").optional(),
    /** Tab and home-screen icon: an inline data:image/... URI (PNG or SVG, small) or an https:// URL. */
    favicon: z
      .string()
      .max(MAX_FAVICON_CHARS, `favicon must be under ${MAX_FAVICON_CHARS} characters (a 64px PNG or a small SVG)`)
      .refine((v) => v.startsWith("data:image/") || v.startsWith("https://"), "favicon must be a data:image/... URI or an https:// URL")
      .optional(),
  })
  .strict();

export type Brand = z.infer<typeof brandSchema>;

export const DEFAULT_BRAND: Brand = BRAND_DEFAULTS;

export interface BrandStatus {
  brand: Brand;
  /** "file" when brand.json is applied; "default" otherwise (see notice for why). */
  source: "default" | "file";
  /** The path consulted, so an operator knows where to put the file. */
  file: string;
  /** Why the file was not applied, in terms of what to change. */
  notice?: string;
}

export function brandFile(): string {
  return process.env.OMB_BRAND_FILE || join(DATA_DIR, "brand.json");
}

/** Never throws. */
export function loadBrand(options: { file?: string; isEntitled?: (feature: string) => boolean } = {}): BrandStatus {
  const file = options.file ?? brandFile();
  const isEntitled = options.isEntitled ?? entitled;
  const fallback = (notice?: string): BrandStatus =>
    notice ? { brand: DEFAULT_BRAND, source: "default", file, notice } : { brand: DEFAULT_BRAND, source: "default", file };
  if (!existsSync(file)) return fallback();
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return fallback(`${file} is not valid JSON (${error instanceof Error ? error.message : String(error)}); using the default brand`);
  }
  const parsed = brandSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fallback(`${file}: ${where}${issue?.message ?? "invalid"}; using the default brand`);
  }
  if (!isEntitled("whitelabel")) {
    return fallback(`${file} found but this server is not licensed for whitelabel; using the default brand`);
  }
  return { brand: parsed.data, source: "file", file };
}

export function describeBrand(status: BrandStatus): string {
  if (status.source === "file") return `brand: ${status.brand.name} (from ${status.file})`;
  return `brand: default${status.notice ? ` (${status.notice})` : ""}`;
}

/** Runtime labels for server-generated prompts and errors. */
export function productName(): string {
  return loadBrand().brand.name;
}

export function assistantDisplayName(): string {
  const brand = loadBrand().brand;
  return brand.assistantName?.trim() || brand.name.trim() || "Assistant";
}

export function cloudProductName(): string {
  const brand = loadBrand().brand;
  return brand.cloudName?.trim() || `${brand.name.trim()} Cloud`;
}

/** Replace legacy product labels in text sent to an agent; wire identifiers stay unchanged. */
export function rebrandAgentText(text: string): string {
  const brand = loadBrand().brand;
  const product = brand.name.trim() || DEFAULT_BRAND.name;
  const assistant = brand.assistantName?.trim() || product || "Assistant";
  const cloud = brand.cloudName?.trim() || `${product} Cloud`;
  return text
    .replaceAll("OpenMausBot Cloud", cloud)
    .replaceAll("MausBot Cloud", cloud)
    .replaceAll("OpenMausBot", product)
    .replaceAll("MausBot", assistant)
    .replace(/(?<![A-Za-z0-9_.-])openmausbot(?![A-Za-z0-9_.:/-])/gi, product);
}
