# Managed HITEK onboarding

`HITEK_MANAGED_SERVICE=1` selects the operator-managed experience on any host.
It is also the default when `HITEK_SUPABASE_URL` is set. Explicit `0` keeps the
desktop/self-install experience. This flag controls presentation, not access
control, secret isolation, or shop isolation.

The product, organization, assistant, logo and colors have one default config:
`shared/brand-defaults.ts`. Both server and browser import it. Existing licensed
`brand.json` overrides continue to work. The CRM integration label may still be
overridden with `HITEK_CONNECT_LABEL`; its URL/client remain deployment settings.

The managed welcome uses the authenticated account, a CRM connection/access
check, and AI service status. No personal provider login or key entry is offered.
Missing infrastructure stays visibly pending; exploring the app only records
that the welcome was seen. Saving failures remain visible and retryable.
`hitek-welcome-v1` is appended to existing onboarding hints, so existing pilot
users see the new experience without an account or chat reset. Settings can
replay it. Member replay does not write workspace configuration.

Run targeted tests:

```sh
pnpm exec vitest run server/hitek-managed.test.ts server/hitek-cloud-api.test.ts src/components/onboarding/HitekWelcome.test.ts src/components/onboarding/WelcomeGate.test.ts src/components/McpServersPanel.hitek.test.ts src/components/SettingsModal.simple.test.ts
```

Run real-renderer verification with Node 24 and Playwright available:

```sh
node --experimental-strip-types scripts/verify-hitek-onboarding.ts
```

`OMB_VERIFY_PLAYWRIGHT` can name an installed Playwright module, and
`OMB_VERIFY_BROWSER_CHROME` an installed Chrome executable. The script owns a
disposable server/home, fake OAuth issuer, fake CRM and headless browser. It
checks desktop/mobile rendering, the shipped logo, missing-service states,
OAuth, tool discovery without CRM business writes, completion/reload/replay,
and managed Settings. Screenshots are saved to
`.omb-scratch/verify-evidence/hitek-onboarding/`. All processes are closed on exit.

Last local verification: 2026-10-26. The real-renderer recipe passed at 1280x900
and 390x844, including OAuth against the fake CRM and an unavailable AI provider.

This does not provision an AI credential or prove a real provider response.
Provider activation, protected credential delivery, per-shop isolation, and
live CRM deployment settings remain separate production work. No platform-wide
provider secret should be placed in an agent execution environment.
