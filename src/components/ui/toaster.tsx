"use client";

import { Toaster as SonnerToaster } from "sonner";

/**
 * Toast host. Mounted once in the root layout; trigger with `toast()` from
 * `sonner` anywhere in the client tree.
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      offset={16}
      gap={10}
      closeButton
      richColors={false}
      toastOptions={{
        style: {
          background: "#18181f",
          border: "1px solid #27272a",
          color: "#f5f5f5",
          borderRadius: "12px",
          fontSize: "14px",
        },
        className: "font-sans",
      }}
    />
  );
}
