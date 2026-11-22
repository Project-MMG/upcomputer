import { Tabs } from "@base-ui/react/tabs";
import type { ReactNode } from "react";

const tabClassName =
  "relative px-3 py-2 text-sm font-medium text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none hover:text-foreground data-[active]:text-foreground data-[active]:after:absolute data-[active]:after:inset-x-3 data-[active]:after:bottom-0 data-[active]:after:h-0.5 data-[active]:after:rounded-full data-[active]:after:bg-foreground";

export function SettingsTabs({
  label,
  tabs,
}: {
  readonly label: string;
  readonly tabs: readonly {
    readonly id: string;
    readonly label: string;
    readonly content: ReactNode;
  }[];
}) {
  return (
    <Tabs.Root defaultValue={tabs[0]?.id} className="flex min-w-0 flex-col gap-6">
      <Tabs.List aria-label={label} className="flex gap-1 border-b border-border">
        {tabs.map((tab) => (
          <Tabs.Tab key={tab.id} value={tab.id} className={tabClassName}>
            {tab.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {tabs.map((tab) => (
        <Tabs.Panel key={tab.id} value={tab.id} className="flex min-w-0 flex-col gap-6">
          {tab.content}
        </Tabs.Panel>
      ))}
    </Tabs.Root>
  );
}
