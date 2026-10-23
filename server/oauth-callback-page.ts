import { DEFAULT_BRAND, loadBrand } from "./brand.ts";

export const OAUTH_CALLBACK_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
} as const;

export function oauthCallbackProductName(): string {
  return loadBrand().brand.name.trim() || DEFAULT_BRAND.name;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

export function renderOAuthCallbackPage(options: { title: string; message: string; success: boolean }): string {
  const { brand } = loadBrand();
  const name = brand.name.trim() || DEFAULT_BRAND.name;
  const accent = brand.accent && /^#[0-9a-f]{6}$/i.test(brand.accent) ? brand.accent : (DEFAULT_BRAND.accent ?? "#E51717");
  const logo = brand.logo && (brand.logo.startsWith("data:image/") || brand.logo.startsWith("https://"))
    ? `<img class="brand-logo" src="${escapeHtml(brand.logo)}" alt="" />`
    : `<span class="brand-mark" aria-hidden="true">H</span>`;
  const icon = options.success ? '<span class="check" aria-hidden="true"></span>' : '<span class="alert" aria-hidden="true">!</span>';
  const eyebrow = options.success ? "Connection complete" : "Sign-in issue";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <meta name="referrer" content="no-referrer" />
    <title>${escapeHtml(options.title)} | ${escapeHtml(name)}</title>
    <style>
      :root { color-scheme: dark; --accent: ${accent}; --bg: #090a0d; --panel: #15171c; --line: #2a2d34; --ink: #f6f7f9; --muted: #9da3af; }
      * { box-sizing: border-box; }
      html, body { min-height: 100%; }
      body { margin: 0; background: var(--bg); color: var(--ink); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .page { min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 32px 20px 24px; }
      .brand { display: flex; align-items: center; gap: 10px; width: min(100%, 460px); color: var(--ink); font-size: 14px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
      .brand-mark { display: grid; width: 28px; height: 28px; place-items: center; border-radius: 7px; background: var(--accent); color: #fff; font-size: 15px; font-weight: 800; letter-spacing: 0; }
      .brand-logo { display: block; max-width: 136px; max-height: 28px; object-fit: contain; }
      .card { width: min(100%, 460px); margin: auto 0; padding: 38px 40px 34px; border: 1px solid var(--line); border-top: 3px solid var(--accent); border-radius: 8px; background: var(--panel); box-shadow: 0 24px 70px rgb(0 0 0 / 32%); text-align: center; }
      .status { display: grid; width: 58px; height: 58px; margin: 0 auto 24px; place-items: center; border: 1px solid color-mix(in srgb, var(--accent) 50%, var(--line)); border-radius: 50%; background: color-mix(in srgb, var(--accent) 12%, var(--panel)); color: var(--accent); }
      .status.error { color: #f6b84a; border-color: #755d2b; background: #262014; }
      .check { width: 20px; height: 11px; border-bottom: 3px solid currentColor; border-left: 3px solid currentColor; transform: translateY(-2px) rotate(-45deg); }
      .alert { font-size: 26px; font-weight: 700; line-height: 1; }
      .eyebrow { margin: 0 0 10px; color: var(--accent); font-size: 11px; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; }
      .status.error + .eyebrow { color: #f6b84a; }
      h1 { margin: 0; font-size: clamp(26px, 5vw, 34px); line-height: 1.12; letter-spacing: 0; }
      .message { max-width: 340px; margin: 16px auto 0; color: var(--muted); font-size: 15px; line-height: 1.6; }
      button { margin-top: 28px; min-height: 44px; width: 100%; border: 0; border-radius: 6px; background: var(--accent); color: #fff; cursor: pointer; font: inherit; font-size: 14px; font-weight: 750; }
      button:hover { filter: brightness(1.08); }
      button:focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 45%, #fff); outline-offset: 3px; }
      .hint { margin: 16px 0 0; color: #747b87; font-size: 12px; line-height: 1.5; }
      footer { color: #626975; font-size: 11px; letter-spacing: .04em; }
      @media (max-width: 520px) { .page { padding: 24px 16px 20px; } .card { padding: 32px 24px 28px; } }
    </style>
  </head>
  <body>
    <div class="page">
      <header class="brand">${logo}<span>${escapeHtml(name)}</span></header>
      <main class="card">
        <div class="status ${options.success ? "success" : "error"}" role="img" aria-label="${options.success ? "Success" : "Sign-in issue"}">${icon}</div>
        <p class="eyebrow">${eyebrow}</p>
        <h1>${escapeHtml(options.title)}</h1>
        <p class="message">${escapeHtml(options.message)}</p>
        <button type="button" onclick="window.close()">Close this tab</button>
        <p class="hint">If the tab stays open, you can close it manually.</p>
      </main>
      <footer>Secure sign-in &middot; ${escapeHtml(name)}</footer>
    </div>
  </body>
</html>`;
}
