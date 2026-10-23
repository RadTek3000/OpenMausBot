export const APP_NAME = "HITEK Agent Desk";
export const APP_REPOSITORY = "https://hitekfilms.com";
export const DOCS_URL = "https://hitekfilms.com";
export const HELP_CENTER_URL = DOCS_URL;
export const APPROVAL_LEVELS_URL = DOCS_URL;
export const PASSKEY_HELP_URL = DOCS_URL;
export const FEEDBACK_URL = DOCS_URL;
export const RELEASES_URL = DOCS_URL;
export const PRICING_URL = DOCS_URL;
export function withSource(url: string, source: string): string {
  const target = new URL(url);
  target.searchParams.set("src", source);
  return target.href;
}
export const LICENSE_URL = DOCS_URL;
export const IOS_APP_STORE_URL = DOCS_URL;
export const ANDROID_APK_URL = DOCS_URL;

export function appVersion(): string {
  return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
}

const PLATFORM_NAMES: Record<string, string> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};

export function platformLabel(platform?: string): string | null {
  return (platform && PLATFORM_NAMES[platform]) ?? null;
}

export async function openExternalLink(url: string): Promise<void> {
  if (window.ogb?.openExternal) {
    await window.ogb.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
