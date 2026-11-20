import { Tabs } from "@base-ui/react/tabs";
import type { ReactNode } from "react";
import { SettingsPageContainer } from "../components/settings/settingsLayout";
import type { SidebarProjectGroupMember } from "../sidebarProjectGrouping";
import { WEB_PRODUCT } from "./productEntry";

const ProjectTools = WEB_PRODUCT.features.find((feature) => feature.projectTools)?.projectTools;
const tab =
  "relative px-3 py-2 text-sm font-medium text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none hover:text-foreground data-[active]:text-foreground data-[active]:after:absolute data-[active]:after:inset-x-3 data-[active]:after:bottom-0 data-[active]:after:h-0.5 data-[active]:after:rounded-full data-[active]:after:bg-foreground";

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
      <Tabs.Root defaultValue="overview" className="flex min-w-0 flex-col gap-6">
        <Tabs.List aria-label="Project settings" className="flex gap-1 border-b border-border">
          <Tabs.Tab value="overview" className={tab}>
            Overview
          </Tabs.Tab>
          <Tabs.Tab value="tools" className={tab}>
            Tools
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="overview">
          <div className="flex flex-col gap-6">{children}</div>
        </Tabs.Panel>
        <Tabs.Panel value="tools">
          <ProjectTools members={members} />
        </Tabs.Panel>
      </Tabs.Root>
    </SettingsPageContainer>
  );
}
