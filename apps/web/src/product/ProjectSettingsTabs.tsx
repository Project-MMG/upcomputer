import type { ReactNode } from "react";
import { SettingsPageContainer } from "../components/settings/settingsLayout";
import { SettingsTabs } from "../components/settings/SettingsTabs";
import type { SidebarProjectGroupMember } from "../sidebarProjectGrouping";
import { WEB_PRODUCT } from "./productEntry";

const ProjectTools = WEB_PRODUCT.features.find((feature) => feature.projectTools)?.projectTools;

export function ProjectSettingsTabs({
  children,
  members,
}: {
  readonly children: ReactNode;
  readonly members: readonly SidebarProjectGroupMember[];
}) {
  if (!ProjectTools)
    return <SettingsPageContainer className="gap-6">{children}</SettingsPageContainer>;
  return (
    <SettingsPageContainer className="gap-6">
      <SettingsTabs
        label="Project settings"
        tabs={[
          { id: "overview", label: "Overview", content: children },
          { id: "tools", label: "Tools", content: <ProjectTools members={members} /> },
        ]}
      />
    </SettingsPageContainer>
  );
}
