// src/ui/kit — Docket's own component kit (WO-0031 "Kontrol Konsolu"): Radix primitives + cva + lucide,
// styled by our tokens, owned by us (labels stay in labels.ts at call sites; no inactive variants —
// ADR-0001 holds by construction).
export { cn } from './cn';
export { Button, type ButtonProps } from './Button';
export { Input, Textarea, Field } from './Input';
export { Dialog } from './Dialog';
export { Segmented } from './Segmented';
export { Tooltip, TooltipProvider } from './Tooltip';
export { Badge, type BadgeTone } from './Badge';
export { Spinner } from './Spinner';
