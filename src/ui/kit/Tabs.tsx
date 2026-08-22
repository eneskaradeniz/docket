// Tabs — Radix-backed (WO-0031). Items declare value+label (labels belong to the call site).
// WO-0031f: both take an optional className (the Akış|Kayıt pair styles itself through the named
// .flowtab classes; the base classes stay the default for any other tab use).
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from './cn';

export const Tabs = TabsPrimitive.Root;

export function TabsList({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <TabsPrimitive.List className={cn('flex gap-1 rounded-md bg-bg p-1 border border-hairline', className)}>{children}</TabsPrimitive.List>
  );
}

export function TabsTrigger({ value, children, className }: { value: string; children: React.ReactNode; className?: string }) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className={cn('flex-1 rounded px-2.5 py-1 text-xs font-medium text-inkdim transition-colors hover:bg-raised/60 hover:text-ink radix-state-active:bg-raised radix-state-active:text-ink', className)}
    >
      {children}
    </TabsPrimitive.Trigger>
  );
}

// forceMount keeps panels in the DOM (the chat column's scroll) — Radix then never applies its own
// hidden (present === forceMount || selected), so the inactive panels must be hidden HERE
// (WO-0031d tur-2 A2: the tab bar visually did nothing; every section stacked forever).
export const TabsContent = ({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) => (
  <TabsPrimitive.Content {...props} className={cn('data-[state=inactive]:hidden', className)} />
);
