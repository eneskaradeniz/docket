// Tooltip — Radix-backed (WO-0031). Content copy from the call site (labels.ts).
import type { ReactNode } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={350}>{children}</TooltipPrimitive.Provider>;
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={6}
          className="z-80 rounded-md border border-hairline bg-raised px-2 py-1 text-[11px] text-ink shadow-lg data-[state=delayed-open]:animate-[rise_0.12s_ease-out]"
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
