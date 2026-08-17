// Tabs — Radix-backed (WO-0031). Items declare value+label (labels belong to the call site).
import * as TabsPrimitive from '@radix-ui/react-tabs';

export const Tabs = TabsPrimitive.Root;

export function TabsList({ children }: { children: React.ReactNode }) {
  return (
    <TabsPrimitive.List className="flex gap-1 rounded-md bg-bg p-1 border border-hairline">{children}</TabsPrimitive.List>
  );
}

export function TabsTrigger({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className="flex-1 rounded px-2.5 py-1 text-xs font-medium text-inkdim transition-colors hover:bg-raised/60 hover:text-ink radix-state-active:bg-raised radix-state-active:text-ink"
    >
      {children}
    </TabsPrimitive.Trigger>
  );
}

export const TabsContent = TabsPrimitive.Content;
