import "~/index.css";

import { EnvironmentId, ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import {
  TaskAgentId,
  type ProjectToolActionsInput,
  type ProjectToolActionDetails,
  type ProjectToolAppGrant,
  type ProjectToolAppGrantInput,
  type ProjectToolAssignment,
  type ProjectToolConnectionInput,
  type ProjectToolGrantInput,
  type ProjectToolSettings,
} from "@t3tools/tasks-contracts/v1";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import type { SidebarProjectGroupMember } from "../sidebarProjectGrouping";
import { ProjectSettingsTabs } from "./ProjectSettingsTabs";

const state = vi.hoisted(() => ({
  api: vi.fn<(environment: EnvironmentId, project: ProjectId) => unknown>(),
  open: vi.fn<(url: string) => Promise<void>>(),
}));

vi.mock("../../../../packages/tasks-web/src/rpc/projectTools.ts", () => ({
  projectToolsApi: state.api,
}));
vi.mock(import("./FeatureRpc"), async (original) => ({
  ...(await original()),
  useExperimentalFeatureRpcPermission: () => true,
}));
vi.mock(import("../localApi"), async (original) => ({
  ...(await original()),
  ensureLocalApi: () => ({ shell: { openExternal: state.open } }) as never,
}));

const member = {
  id: ProjectId.make("notes-checkout"),
  environmentId: EnvironmentId.make("fixture-environment"),
  environmentLabel: "Test environment",
  physicalProjectKey: "test-checkout",
  title: "Notes",
  workspaceRoot: "/fixtures/notes",
  defaultModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "fixture" },
  scripts: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} satisfies SidebarProjectGroupMember;

function setup() {
  const read: ProjectToolActionDetails = {
    slug: "NOTES_VIEW",
    name: "Read notes",
    app: "notes",
    appName: "Fixture Notes",
    description: "List repository notes.",
    effect: "read",
    requiresAccount: true,
    inputSchema: { type: "object", properties: { repository: { type: "string" } } },
  };
  const write: ProjectToolActionDetails = {
    ...read,
    slug: "NOTES_CREATE",
    name: "Write note",
    description: "Create a repository note.",
    effect: "write",
  };
  const bots = [
    { id: TaskAgentId.make("scout"), name: "Scout" },
    { id: TaskAgentId.make("writer"), name: "Writer" },
    { id: TaskAgentId.make("idle"), name: "Idle" },
  ];
  const appDetails = {
    slug: "notes",
    name: "Fixture Notes",
    description: "Repository notes.",
    setup: "connect",
  } as const;
  const account = "Notes sandbox account";
  const link = "https://connect.composio.dev/link/notes-fixture";
  let connected = false;
  let pending = false;
  let signedIn = false;
  let assignment: ProjectToolAssignment | undefined;
  let appGrant: ProjectToolAppGrant | undefined;
  state.open.mockReset().mockImplementation(async (url) => {
    expect(url).toBe(link);
    signedIn = true;
  });
  state.api.mockReset().mockImplementation((environment, project) => {
    expect(environment).toBe(member.environmentId);
    expect(project).toBe(member.id);
    return {
      settings: async (): Promise<ProjectToolSettings> => ({
        configured: true,
        accounts:
          connected || pending
            ? [
                {
                  app: "notes",
                  account: connected ? { label: account, status: "connected" } : null,
                  pending,
                },
              ]
            : [],
        bots,
        assignments: assignment ? [assignment] : [],
        appGrants: appGrant ? [appGrant] : [],
      }),
      apps: async () => ({
        items: [appDetails],
        nextCursor: null,
      }),
      actions: async ({
        query,
        cursor,
      }: Pick<typeof ProjectToolActionsInput.Type, "query" | "cursor">) =>
        query === "repository"
          ? cursor === "next"
            ? { items: [write], nextCursor: null }
            : { items: [read], nextCursor: "next" }
          : { items: [read, write], nextCursor: null },
      app: async () => appDetails,
      action: async (slug: string) => (slug === write.slug ? write : read),
      connection: async ({ app, operation }: Omit<ProjectToolConnectionInput, "projectId">) => {
        expect(app).toBe("notes");
        if (operation === "start") {
          pending = true;
          return { url: link };
        }
        if (operation === "finish") {
          expect(signedIn).toBe(true);
          pending = false;
          connected = true;
        }
        return { url: null };
      },
      grant: async ({ slug, audience, fixedInputs }: Omit<ProjectToolGrantInput, "projectId">) => {
        expect(slug).toBe(write.slug);
        if (audience === null) {
          assignment = undefined;
          return;
        }
        expect(connected).toBe(true);
        expect(fixedInputs).toEqual({ repository: "org/project" });
        if (audience.kind === "all")
          assignment = { action: write, status: "available", audience, fixedInputs };
        else {
          expect(audience.botIds).toEqual([bots[0]!.id]);
          assignment = {
            action: write,
            status: "available",
            audience: { kind: "selected", botIds: [bots[0]!.id] },
            fixedInputs,
          };
        }
      },
      grantApp: async ({ app, audience }: Omit<ProjectToolAppGrantInput, "projectId">) => {
        expect(app).toBe(appDetails.slug);
        expect(connected).toBe(true);
        if (audience?.kind === "selected") {
          expect(audience.botIds).toEqual([bots[1]!.id]);
          appGrant = {
            app: appDetails,
            audience: { kind: "selected", botIds: [bots[1]!.id] },
          };
        } else {
          appGrant = audience ? { app: appDetails, audience } : undefined;
        }
      },
    };
  });
}

it("manages full app access, no access, and individual actions from Project Settings", async () => {
  setup();
  await using screen = await render(
    <ProjectSettingsTabs members={[member]}>
      <p>Project overview</p>
    </ProjectSettingsTabs>,
  );
  await userEvent.click(screen.getByRole("tab", { name: "Tools" }));
  await expect.element(screen.getByRole("searchbox", { name: "Search apps" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Manage access" }));
  const dialog = page.getByRole("dialog");
  await userEvent.click(dialog.getByRole("button", { name: "Connect", exact: true }));
  await userEvent.click(dialog.getByRole("button", { name: "Open Composio sign-in" }));
  await userEvent.click(dialog.getByRole("button", { name: "Check connection" }));
  await expect.element(dialog.getByText("Notes sandbox account", { exact: true })).toBeVisible();
  await userEvent.click(dialog.getByText("Individual actions", { exact: true }));

  await userEvent.fill(dialog.getByRole("searchbox", { name: "Search actions" }), "repository");
  await userEvent.click(dialog.getByRole("button", { name: "Search", exact: true }));
  await expect.element(dialog.getByText("Read notes", { exact: true })).toBeVisible();
  await userEvent.click(dialog.getByRole("button", { name: "Load more" }));
  await expect.element(dialog.getByText("Write note", { exact: true })).toBeVisible();
  await userEvent.click(dialog.getByRole("button", { name: "Configure" }).last());

  await expect
    .element(dialog.getByRole("radio", { name: "All bots in this project" }))
    .toBeChecked();
  await userEvent.click(dialog.getByText("Fixed inputs (optional)", { exact: true }));
  await userEvent.fill(
    dialog.getByRole("textbox", { name: "Fixed inputs as JSON" }),
    '{"repository":"org/project"}',
  );
  await userEvent.click(dialog.getByRole("button", { name: "Save assignment" }));
  await expect.element(page.getByRole("dialog", { name: "Fixture Notes" })).toBeVisible();
  await userEvent.click(dialog.getByRole("button", { name: "Close", exact: true }));
  await expect.element(screen.getByText("All bots in this project", { exact: true })).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "Edit assignment" }).first());
  await userEvent.click(dialog.getByRole("radio", { name: "Selected bots" }));
  await userEvent.click(dialog.getByRole("checkbox", { name: "Scout" }));
  await userEvent.click(dialog.getByRole("button", { name: "Save assignment" }));
  await expect.element(screen.getByText("Scout", { exact: true })).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "Manage access", exact: true }));
  await userEvent.click(dialog.getByRole("radio", { name: "Selected bots" }));
  await userEvent.click(dialog.getByRole("checkbox", { name: "Writer" }));
  await expect.element(dialog.getByText("Full access", { exact: true })).toBeVisible();
  await expect.element(dialog.getByText("1 action", { exact: true })).toBeVisible();
  await expect.element(dialog.getByText("No access", { exact: true })).toBeVisible();
  await userEvent.click(dialog.getByRole("button", { name: "Save app access" }));
  await expect
    .element(screen.getByText("Full access for 1 bot · 1 individual action"))
    .toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "Turn off", exact: true }));
  await expect.element(screen.getByText("Full access for 1 bot", { exact: true })).toBeVisible();
});
