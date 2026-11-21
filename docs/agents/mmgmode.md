# MMG workflow for Project-MMG/upcomputer

GitHub Issues in [Project-MMG/upcomputer](https://github.com/Project-MMG/upcomputer/issues) are the
tracker for approved work. `origin` is `https://github.com/Project-MMG/upcomputer.git`.

1. Confirm the goal, scope, acceptance criteria, and verification before implementation. For
   larger features, record the spec in a parent issue and agree on the ticket breakdown.
2. Publish approved tickets as GitHub issues. Attach each child to its exact spec parent and use
   GitHub's dependency relationships for blockers. Use `ready-for-agent` when the work is approved
   and the owner can start.
3. In MMG mode, give each approved implementation ticket its own visible owner chat. Work through
   tickets in order when they share a checkout. Record the source base, verified head, and result
   in the ticket or PR.
4. Use the [project verification rules](../../AGENTS.md#verifying). Open the linked PR on
   Project-MMG/upcomputer when the work is ready for review. For stacked work, target the branch
   named in the ticket and update the base when its prerequisite lands.
5. Keep implementation issues open through review. Check that the accepted change reached the
   intended branch before recording completion. Close a parent spec after all required children
   have landed and the full acceptance test passes.

Read the [agent instructions](../../AGENTS.md), [project glossary](../internals/glossary.md), and
[contribution guide](../../CONTRIBUTING.md) for repository conventions.
