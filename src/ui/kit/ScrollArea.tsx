// ScrollArea — Radix-backed (WO-0031): themed thin scrollbar for inner panes (the global scrollbar
// style covers the page; this one rides inside cards/rails with a hover-visible thumb).
import type { ReactNode } from 'react';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import { cn } from './cn';

export function ScrollArea({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ScrollAreaPrimitive.Root className={cn('overflow-hidden', className)}>
      <ScrollAreaPrimitive.Viewport className="h-full w-full">{children}</ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        orientation="vertical"
        className="flex w-1.5 touch-none select-none p-0.5 transition-colors"
      >
        <ScrollAreaPrimitive.Thumb className="flex-1 rounded-full bg-hairline hover:bg-inkdim/60" />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}
