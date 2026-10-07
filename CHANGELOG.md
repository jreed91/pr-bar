# pr-bar

## 0.8.0

### Minor Changes

- [#26](https://github.com/jreed91/pr-bar/pull/26) [`c5b6912`](https://github.com/jreed91/pr-bar/commit/c5b691240c85f76d6a9ed4013b81300729795d0d) Thanks [@jreed91](https://github.com/jreed91)! - Pressing another PR in the pane's stack list checks out its branch: PrBar fetches it from origin, switches to it (fast-forwarding a local copy that is behind) and refuses while tracked files have changes. The ↗ beside each row still opens the PR on GitHub.

### Patch Changes

- [#18](https://github.com/jreed91/pr-bar/pull/18) [`2729fbd`](https://github.com/jreed91/pr-bar/commit/2729fbda1e3b4d994e3e5b63107de7f470fe5c1a) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump typescript from 5.9.3 to 7.0.2

## 0.7.6

### Patch Changes

- [#22](https://github.com/jreed91/pr-bar/pull/22) [`7bbb46a`](https://github.com/jreed91/pr-bar/commit/7bbb46a94e3ec500809df25a4f473802ef7868be) Thanks [@jreed91](https://github.com/jreed91)! - Lint with Biome instead of ESLint, and release with changesets: PRs add a changeset instead of bumping the version, and merging the release PR tags the version and publishes a GitHub release.
