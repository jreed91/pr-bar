# PrBar

A Claude Code mod that puts the current branch's GitHub PR above the prompt, so a red CI or a new review comment shows without leaving the terminal.

![The compact bar above the prompt: PR #42, one failing check, changes requested, two new review comments and two attachments](docs/screenshots/bar.png)

![The /pr pane beside the transcript, with the failing check selected and its log tail loaded](docs/screenshots/pane-check.png)

![The /pr pane with an inline review comment selected: opened in place as a card with its full path, the commented lines, its text, Attach to prompt and Open on GitHub](docs/screenshots/pane-comment.png)

_The screenshots are the trees the mod draws for a sample PR, captured through `claude plugin test` and rendered in a terminal frame._

It starts quiet and you opt into more:

- **Bar** (above the prompt): one line with the PR number (a link), its title, the count of new review comments, the CI state (`✗ 1 failing`, `◌ 2 running` or `✓ CI`), the review decision, a merge conflict and the count of attachments. Focus it with ctrl+x tab and press `d` for details.
- **Pane** (`/pr` or `d`): a folded `Description` row first: press it for the PR description as markdown, its images drawn in place (PNGs, in a terminal that shows pictures such as kitty or Ghostty; other images, and other terminals, get a link with the alt text). Then comments: the inline review comments, unread first, one line each, with the conversation (review summaries, bot reports such as coverage) folded into one line. Then failing and running checks, with the passing ones folded into one line. It opens on the first unread comment, else the first failing check. Press either folded line to expand it for the session. Long lists stop at ten rows (the conversation at four) with an `N more` row that shows the rest in place, and `show fewer` that caps it again. Pressing the open row closes it. Pick a row and it opens in place, under itself: a check's log tail (`l` to load), or a comment's text with the code it points at, the last lines of the diff down to the commented line, numbered as on GitHub. Comment bodies are drawn as markdown, with GitHub's HTML (badges, headings, collapsed sections) turned into text. `m` marks the PR's comments read, `r` refreshes.
- **Hand-off**: **Attach to prompt** on a failing check (`f`, with its log tail) or a comment (`a`), or `u` (beside Review comments) to attach every unread comment at once, oldest first, so you can type "address all of these"; any that would take the prompt past its 40,000-character allowance are left out and counted. The bar shows `📎 N for next prompt` until you send one; that prompt carries the items as context, once, so you can type just "fix this", and a dim line under it in the transcript names what went with it. Prompts that arrive on their own (a background task's, another session's) leave them for yours. Nothing is typed or sent for you.
- **Alerts**: a toast when CI turns red (never on the first poll).

## Settings

Set these in `/config` (or `/plugin configure pr-bar@jreed91`):

| Setting | Default | What it does |
| --- | --- | --- |
| Bar layout | `compact` | `full` adds a second row: the failing check names, each attachment, and Details / Mark read / Refresh buttons |
| List passing checks | off | Lists passing and skipped checks in the pane instead of one folded line |
| Show conversation comments | off | Lists conversation comments and review summaries in the pane and counts them in the bar; inline review comments always show |
| Show resolved threads | off | Lists the comments on resolved review threads in the pane, dimmed and after the open ones, instead of one folded `N resolved` line. They never count as new |
| Open the pane for a new PR | on | Opens the pane when a PR is opened for your branch during the session, for example by `gh pr create`. Once per PR; a PR that was already open doesn't open it |
| GitHub token | none | Used only when no other token is found (see below) |

## Data

- Repo and branch come from `.git/HEAD` and the `origin` remote. The bar hides outside a github.com checkout or on a detached HEAD.
- Token, first found wins: `GH_TOKEN`, `GITHUB_TOKEN`, `gh auth token`, then the plugin's secret `githubToken` setting (`/config`).
- One GraphQL request per poll: every 20s while a check is pending, 90s otherwise, 5 min after a rate limit or network error. A `git push`, `git checkout`/`switch` or `gh pr …` run by Claude refreshes right away, and so does a branch switch (HEAD is read every 2s, locally).
- New comments are inline review comments newer than your last Mark read for that PR (kept across sessions), excluding your own; bots count. With the conversation setting on, conversation comments and review summaries count too. Resolved threads never count; the pane folds them into one line you can open.

## What it reads, runs and sends

Everything the mod reaches, so you can decide whether to trust it (`claude plugin validate .` lists the same):

- **Reads** the session's git checkout: `.git/HEAD` (or a worktree's `.git` pointer file) and the `origin` remote URL. Nothing else on disk, except the description images it saved itself (below).
- **Reads your GitHub token** from, in order, the `GH_TOKEN` or `GITHUB_TOKEN` environment variable, the output of `gh auth token --hostname github.com` (the one command it runs for this), or the secret `githubToken` setting. The token is sent only to `api.github.com`.
- **Sends** one GraphQL request to `https://api.github.com/graphql` per poll, naming the repository and branch. When you press Attach to prompt or Load log on a GitHub Actions check, it also asks `https://api.github.com/repos/<owner>/<repo>/actions/jobs/<id>/logs` and follows its redirect to GitHub's log storage (no token is sent there).
- **Fetches description images** only when you open the Description: up to six, each once a session, with `curl` (at most 2 MiB, 20 s each) into a folder `mktemp -d` makes, then reads them back. It fetches the addresses in GitHub's rendering of the description: GitHub's own image hosts, short-lived signed links for a private repo. No token is sent.
- **Keeps** one value per PR in the plugin's own store: when you last pressed Mark read.
- **Adds to your prompt** only what you attach with Attach to prompt, on the next prompt you send, as context Claude reads. Nothing is submitted for you.

Nothing goes anywhere else: no telemetry, no third-party hosts.

## Install

This repo is its own plugin marketplace. In Claude Code:

```
/plugin marketplace add jreed91/pr-bar
/plugin install pr-bar@jreed91
```

Or from your shell: `claude plugin marketplace add jreed91/pr-bar` then `claude plugin install pr-bar@jreed91`. Run `/reload-plugins` in an open session, or start a new one.

If `GH_TOKEN`, `GITHUB_TOKEN` or `gh auth login` already give you a token, there is nothing to configure. Otherwise set the secret token with `/plugin configure pr-bar@jreed91` (the install may mention that option is unset; it is optional).

Coming from `pr-band@jreed91`? The plugin is now `pr-bar`, a different plugin id, so remove the old one (`/plugin uninstall pr-band@jreed91`) and install this one. Its settings and which comments you marked read start fresh.

To try a local checkout without installing: `claude --plugin-dir /path/to/pr-bar`.

## License

MIT, see [LICENSE](LICENSE).

## Develop

```sh
npm ci
npm run check   # lint, types, typecheck, validate, test, coverage
```

Or one at a time: `npm run lint` (ESLint), `npm run types` then `npm run typecheck` (lays the engine's plugin API types in `.claude-plugin/types/` and runs `tsc`), `npm run validate` (`claude plugin validate --strict`), `npm test` (`claude plugin test .`) and `npm run coverage`. Coverage must be 100% of statements, branches, functions and lines in `hooks/`, with nothing excluded; `scripts/coverage.mjs` explains how it measures both the test files and the plugin the engine loads. CI (`.github/workflows/ci.yml`) runs the same on every push to main and every pull request, with Claude Code pinned in `CLAUDE_CODE_VERSION`.

`hooks/register.tsx` wires the events; `hooks/git`, `hooks/github`, `hooks/model` and `hooks/views` are its parts. Like the built-in `/diff` mod, every `$` call is spelled once in `session.start` (the `Host` in `hooks/host.ts`), so `claude plugin validate` can list what the mod reaches.
