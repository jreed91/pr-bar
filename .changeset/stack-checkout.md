---
"pr-bar": minor
---

Pressing another PR in the pane's stack list checks out its branch: PrBar fetches it from origin, switches to it (fast-forwarding a local copy that is behind) and refuses while tracked files have changes. The ↗ beside each row still opens the PR on GitHub.
