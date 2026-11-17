"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * Sheet — mobile navigation drawer / side panel.
 * Uses Radix Dialog semantics so focus trapping, Escape handling and ARIA are
 * correct on every device.
 */

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;

const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    side?: "left" | "right" | "bottom";
  }
>(({ className, children, side = "left", ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px]",
        "data-[state=open]:animate-[lux-overlay-in_180ms_ease-out]",
        "data-[state=closed]:animate-[lux-overlay-out_150ms_ease-in]",
      )}
    />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-50 flex flex-col border-line bg-surface shadow-2xl",
        side === "left" &&
          "inset-y-0 left-0 h-full w-[86vw] max-w-xs border-r data-[state=open]:animate-[lux-drawer-in_240ms_var(--ease-lux)] data-[state=closed]:animate-[lux-drawer-out_180ms_ease-in]",
        side === "right" &&
          "inset-y-0 right-0 h-full w-[92vw] max-w-md border-l data-[state=open]:animate-[lux-content-in_240ms_var(--ease-lux)]",
        side === "bottom" &&
          "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-xl border-t data-[state=open]:animate-[lux-content-in_240ms_var(--ease-lux)]",
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        className="absolute right-3 top-3 grid size-11 place-items-center rounded-md text-muted transition-colors hover:bg-card hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        aria-label="Close menu"
      >
        <X className="size-4" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = "SheetContent";

const SheetTitle = DialogPrimitive.Title;
const SheetDescription = DialogPrimitive.Description;

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetTitle, SheetDescription };
