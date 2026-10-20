# Changelog

## 0.2.2

- The 5-hour bar is four blocks to the week's eight. Two eight-block bars of double-width emoji
  plus their text overran the hover and wrapped, which split a countdown like "1d 9h" across
  two lines; and giving a week and a five-hour window the same number of blocks invited reading
  one against the other when they measure different spans.
- The countdown says what it is. "1d 9h" on its own told you nothing — the column header now
  reads **Week · resets in**, so the unit is stated once rather than in every cell, where it
  would have cost the width that caused the wrapping.
- The plan, the per-model limits, the weekly breakdown and the footnote are separate lines
  instead of running together into one paragraph.

## 0.2.1

- The percentage beside a bar is just the number now. The bar already says which way it
  points, and the hover's footer still states the convention once.

## 0.2.0

**Important: do not use Claude Code's Logout.** Logging out revokes that account's sign-in
server-side — the access token *and* the refresh token — so any copy this extension holds stops
working permanently. Measured, not guessed: a revoked account returns
`401 "OAuth access token has been revoked"` and its refresh returns `400 invalid_grant`.

- **The add-account wizard no longer signs you out.** It used to call Claude Code's logout
  between accounts, which revoked the account it had just saved — so collecting several
  accounts quietly destroyed all but the last. It now asks you to `/login` as the next account,
  which replaces the stored sign-in without revoking anything.
- **The hover is a table.** One row per account — account, week, 5-hour — with a coloured bar
  that fills as quota is spent, in place of the mixture of prose and bullets that came before.
  Green under 50% spent, amber to 75, orange to 90, red beyond.
- One convention for every number: a bar and the figure beside it both show quota **spent**.
  The status bar still shows what is **left**, and now says so in the word.
- Revoked accounts are named as revoked and say to re-add them, instead of the ambiguous
  "needs signing in again".
- The panel's bars are coloured too.

## 0.1.1

- Sync setup now says what went wrong when VS Code cannot save settings. The three settings
  writes sat outside any error handling, so a machine whose `settings.json` VS Code will not
  write — a syntax error in it, a read-only profile, a Settings Sync conflict — failed with
  VS Code's bare "unable to write" and no hint where to look. It now names the cause and offers
  to open `settings.json`.
- A failed sync setup offers **Show logs** and **Run Doctor** rather than a dead end.
- Doctor proves the extension's own directory is writable instead of assuming it, and reports
  whether settings can be written at all.

## 0.1.0

First build.

- Status bar showing the account in use, the 5-hour window, the week and a countdown to the
  next reset, with a tooltip carrying per-model limits and what has been spending the week.
- Works with no configuration: the sign-in Claude Code already holds becomes the first account.
- Account switcher with live figures for every saved account, and a panel view with bars,
  reset times and sync state.
- Guided flow for adding another account, built on Claude Code's own sign-in rather than a
  reimplementation of it.
- Optional sync: every account in one scrypt + AES-256-GCM bundle in a private git repository,
  with payload-level merging and a per-machine presence note.
- Optional auto-failover: when the account in use runs out, move to the account whose weekly
  window resets soonest among those with quota left. Off by default, announced when it fires,
  undoable in one click.
- Local estimate from session logs when Anthropic's figures cannot be reached, always marked
  as an estimate and never shown until it has been calibrated against a real reading.
- `Claude Multi Session: Doctor` — one page reporting what the extension can actually see.
