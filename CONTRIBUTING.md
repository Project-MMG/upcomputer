# Contributing to Project-MMG/upcomputer

Project-MMG tracks changes for this version of Up.computer in its own GitHub repository. Use
[Issues](https://github.com/Project-MMG/upcomputer/issues) to agree on work and
[Pull requests](https://github.com/Project-MMG/upcomputer/pulls) to review it.

## Set up a checkout

Use the [development runbook](./docs/operations/development.md) and confirm that the fetch and
push URLs of `origin` point to `https://github.com/Project-MMG/upcomputer.git`.

<a id="prior-approval"></a>

## Agree on the issue

Open an issue for the outcome you want. For a bug, include the app version, platform, provider,
steps to reproduce, and expected result. For a feature, describe the user workflow and how to
verify it.

For larger changes, review the spec and ticket breakdown before implementation. Keep one sub-issue
per independently verifiable ticket and link its blockers in GitHub. Follow the
[MMG workflow](./docs/agents/mmgmode.md) when using MMG mode.

<a id="one-problem"></a>

## Open a focused pull request

Use a branch for the issue. Target the default branch or the integration branch the issue names.
For dependent changes, target the verified prerequisite branch and retarget when it lands.

Link the issue in the PR and describe the problem and what this change delivers. Use
`Closes #123` when the PR completes the entire issue. Use a regular issue link when the PR
delivers part of the work.

<a id="verification"></a>

## Show that the change works

Run `vp run check:changed` with the relevant base before pushing. Add focused tests for changed
logic and verify the affected workflow in a real client when it changes the UI. Attach before and
after evidence for UI changes. Include a short recording when it shows a behavior a still image
cannot capture. Record any verification gaps in the PR.

<a id="closure-and-reconsideration"></a>

## Review and land

Resolve review feedback and verify the resulting head. The maintainer approves merges and release
rollouts. Reconcile issue status after the verified change reaches the intended branch.

## Security reports

Share vulnerability reports privately with the fork maintainers. [Security policy](./.github/SECURITY.md)
