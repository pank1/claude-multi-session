# Changelog

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
