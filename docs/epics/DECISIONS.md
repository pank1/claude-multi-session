# Decisions — Claude Multi Session

Locked unless superseded. Each entry: the call, then why.

---

**D-01 — Usage comes from `GET https://api.anthropic.com/api/oauth/usage`.**
Probed on 2026-10-10 against the installed client (2.1.296): a plain `Authorization: Bearer
<accessToken>` GET returns `five_hour{utilization,resets_at}`, `seven_day{...}`, a `limits[]`
array with `kind`/`percent`/`severity`/`resets_at`/`is_active`, and `seven_day_breakdown.rows`
by surface. No session, no extra header required. This is what resolves the open question from
scoping: **idle accounts can be polled**, so headroom-based failover is real rather than
guessed.

**D-02 — We do not implement Claude's OAuth login.**
The client uses PKCE against its own `client_id`. A published third-party extension performing
that flow is impersonating the official client, and any change to it breaks first-run for every
installer. Instead: *capture* — the user signs in with Claude Code's own
`/login`, and Claude Multi Session copies the resulting credentials into a labelled profile. The
add-account wizard drives the official `claude-vscode.logout` command and waits for the next
login. Fewer moving parts, nothing to break, nothing to impersonate.

**D-03 — Official numbers, with a labelled local estimate as fallback.**
When the endpoint errors or the machine is offline, show the last snapshot with a relative
"as of" marker; if there is no snapshot at all, fall back to a token-volume estimate derived
from `~/.claude/projects/**.jsonl`. The estimate is always rendered with a `~` and the tooltip
says it is an estimate. A failing endpoint never produces an error toast.

**D-04 — Encryption is Node's `scrypt` + `AES-256-GCM`, not the `age` CLI.**
*Supersedes the round-2 answer "private git repo + age/sops".* The transport is unchanged
(private git repo). Only the cipher moves in-process. Two reasons: the round-3 choice of a
**passphrase** prompt made age's recipient/key-file model moot, and requiring a stranger to
install `age` before the extension works contradicts the first-run goal. The construction is
the same shape age uses in passphrase mode (scrypt KDF → AEAD). Format is documented in
`docs/BUNDLE-FORMAT.md` so a bundle is always recoverable without this extension.

**D-05 — Credential store is platform-native.**
Linux/Windows: `~/.claude/.credentials.json`, mode 600, written tmp+rename in the same
directory so a switch is atomic. macOS: the login keychain via `security`, with a file
fallback. Every write takes a timestamped backup under `~/.claude-multi-session/backups/` first.

**D-06 — Claude Code refreshes the account in use; Claude Multi Session refreshes the idle ones.**
*Revised during build.* The first draft said "only the active machine refreshes", which is
backwards: the **active** account's token is already being refreshed by Claude Code itself, so
refreshing it in parallel would have both rotating the same token and one of them losing. For
the active account we therefore only ever *re-read* the credential store. Idle accounts are
the opposite case — nothing else on the machine will refresh them, and without a live token
there are no figures for the failover picker, so Claude Multi Session refreshes those. Rotation across
machines is handled by pushing the rotated credentials to sync immediately, by `mergeProfiles`
preferring whichever copy expires later, and by treating a 401 on refresh as "another machine
got there first": pull, retry once, and only then mark the account as needing sign-in.
Setting: `claudeMultiSession.refreshPolicy` = `auto` (default) or `none`.

**D-07 — Failover picker.**
Eligible: weekly utilization < `weeklyExhaustedPercent` (95), 5-hour window not exhausted or
locked, snapshot not stale beyond `staleAfterMinutes`. Among those, **soonest weekly reset
wins** — that quota disappears first. On the post-window hop, require > `preferredWeeklyLeft`
(50) % weekly remaining and only drop that requirement if nothing qualifies. Ties: lower weekly
utilization, then label, so six machines pick deterministically. Thresholds are settings.

**D-08 — Failover ships off by default.**
Audience 1 has one account; an extension that moves their credentials unasked is hostile. On,
it is announced every time it fires, with the reason.

**D-09 — Presence is advisory, never blocking.**
Each machine writes `presence/<machine>.json` (machine name, opaque account id, timestamp — no
emails) outside the encrypted bundle, so a heartbeat does not rewrite the ciphertext and churn
git. The UI shows "in use on xp17 · 4m ago". Nothing is ever prevented.

**D-10 — Switch = atomic credential swap, then restart.**
Default `restart: "reload"` — kill claude processes that are not protected, then reload the
window, which lets the official extension respawn and resume (it already has
`claudeCode.continueAfterReload`). `"kill"` is the hard variant, `"none"` swaps only. The PID
of the session that requested the switch is protected by default so the extension cannot
decapitate the conversation that invoked it.

**D-11 — Name is "Claude Multi Session", with the job in the subtitle.**
Display name "Claude Multi Session — usage, limits & account switching", extension id
`claude-multi-session`, publisher `QuantLabs` — a company of yours, not something that could be mistaken for
Anthropic. The subtitle carries the work the extension actually does, because "session" in this
corner of the Marketplace usually means a saved conversation, and this does not manage
conversations. The README says plainly that it is unofficial and unaffiliated.

**D-16 — Never sign out of Claude Code to add an account. Measured 2026-10-20.**
Logging out revokes the token family server-side. Both halves: the access token comes back
`401 "OAuth access token has been revoked"` and the refresh token comes back
`400 invalid_grant "Refresh token not found or invalid"`. There is no recovery — a revoked
account can only be signed into again.

The first add-account wizard called `claude-vscode.logout` between accounts, so every account
it saved was destroyed by the next run. Four of six accounts on the first real fleet were dead
on arrival and the extension correctly, uselessly, reported them as needing sign-in.

`/login` replaces the stored credentials without revoking anything, so that is the only path
the wizard offers now, stated twice and in the README. The lesson generalises: the stored
credential being *unexpired* says nothing about it being *valid*, so the UI must distinguish
"token expired" from "token revoked" — only the first is recoverable by refreshing.

**D-17 — One convention for every number: bars show quota spent.**
The first hover mixed "99% left" against bars drawn from percent used, listed the active
account as prose and the rest as bullets in a different format, and was fairly described as
confusing. Every account is now one row of a table — account, week, 5-hour — with a coloured
bar that fills as quota is spent and a figure in the same direction as the bar. The status bar
is the single exception and says "left" in the word, because at a glance what you want is what
remains.

**D-12 — Positioned as quota visibility, not limit evasion.**
The README leads with status and resets, describes failover as "move to the account whose quota
expires soonest", and says plainly: this manages subscriptions you already own and pay for; it
does not raise, pool or bypass any limit. Failover off by default (D-08) is part of this.

**D-14 — Accounts are stored at rest the way Claude Code stores its own.**
`~/.claude-multi-session/profiles.json`, mode 0600, tokens in the clear — the same posture as
`~/.claude/.credentials.json`, which already sits next to it. Encrypting at rest would mean
unlocking before you could switch, which would make the single-account case worse for no real
gain against an attacker who can already read the file beside it. Encryption is for the copy
that leaves the machine. Stated plainly in the README's privacy section.

**D-13 — `src/core/**` imports nothing from `vscode`.**
Policy, crypto, parsing, time and the API client are plain Node so `node:test` can cover them
without an Electron harness. `npm run check` therefore runs in CI on a clean box.

**D-18 — A revoked account is a sign-in button, not an error.**
Choosing a revoked account used to refuse with "needs signing in again", and the add-account
wizard waited silently for a sign-in it had not started — which is indistinguishable from a
hang. Both now drive `claude auth login --claudeai --email <that account>`, found on PATH or in
the official extension's bundled binary, in a terminal, and watch the credential store for the
result. Pre-filling the address is the difference between "sign in again" and "sign in again,
as which one?" — and since the sign-in page does not force the choice, the account that comes
back is checked against the one asked for.
