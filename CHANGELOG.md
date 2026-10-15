# pr-bar

## 0.10.0

### Minor Changes

- [#30](https://github.com/jreed91/pr-bar/pull/30) [`5dfc453`](https://github.com/jreed91/pr-bar/commit/5dfc4536ee74df567f97432ae7c440c45086415f) Thanks [@jreed91](https://github.com/jreed91)! - On the desktop the pane draws the PR's checks as a timeline above the list: one bar per check from its start to its end, colored by state, with a tooltip naming the check, its state and how long it took. The README shows the desktop pane.

### Patch Changes

- [#30](https://github.com/jreed91/pr-bar/pull/30) [`4248f2e`](https://github.com/jreed91/pr-bar/commit/4248f2e7e768ed242f33f60e5e801f2eb4bc3faf) Thanks [@jreed91](https://github.com/jreed91)! - The pane draws again on the desktop under Claude Code versions that take a Button's label alone: each row is a plain label held under 300 characters for the app to truncate, instead of a label made of styled text.

## 0.9.0

### Minor Changes

- [#28](https://github.com/jreed91/pr-bar/pull/28) [`da79291`](https://github.com/jreed91/pr-bar/commit/da79291c56e75e4ef20d2a210eb6de7702efa20b) Thanks [@jreed91](https://github.com/jreed91)! - The desktop app gets its own layout: titles and list rows are left whole for the app to truncate rather than cut to a column count, Details is the full bar's primary button, and an open row's card is indented instead of boxed. A description image too large to show on the desktop is shrunk to a JPEG with macOS's `sips` first, and stays a link where `sips` is not available. The bar and pane tests now run on the terminal and the desktop.

## 0.8.0

### Minor Changes

- [#27](https://github.com/jreed91/pr-bar/pull/27) [`76a7f4f`](https://github.com/jreed91/pr-bar/commit/76a7f4f0a39e5f664efa23c63603a2ee1a21b9ae) Thanks [@jreed91](https://github.com/jreed91)! - The pane draws the PR description's PNG images in the Claude desktop app, where they were only links before; a PNG too large for the desktop's picture element stays a link. The README says how to install PrBar from the desktop app and where it finds the token there.

- [#26](https://github.com/jreed91/pr-bar/pull/26) [`c5b6912`](https://github.com/jreed91/pr-bar/commit/c5b691240c85f76d6a9ed4013b81300729795d0d) Thanks [@jreed91](https://github.com/jreed91)! - Pressing another PR in the pane's stack list checks out its branch: PrBar fetches it from origin, switches to it (fast-forwarding a local copy that is behind) and refuses while tracked files have changes. The ↗ beside each row still opens the PR on GitHub.

### Patch Changes

- [#18](https://github.com/jreed91/pr-bar/pull/18) [`2729fbd`](https://github.com/jreed91/pr-bar/commit/2729fbda1e3b4d994e3e5b63107de7f470fe5c1a) Thanks [@dependabot](https://github.com/apps/dependabot)! - Bump typescript from 5.9.3 to 7.0.2

## 0.7.6

### Patch Changes

- [#22](https://github.com/jreed91/pr-bar/pull/22) [`7bbb46a`](https://github.com/jreed91/pr-bar/commit/7bbb46a94e3ec500809df25a4f473802ef7868be) Thanks [@jreed91](https://github.com/jreed91)! - Lint with Biome instead of ESLint, and release with changesets: PRs add a changeset instead of bumping the version, and merging the release PR tags the version and publishes a GitHub release.
