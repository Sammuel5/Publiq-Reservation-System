"use client";

import { TimerReset } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { adminFetch } from "@/components/admin/api-client";
import { useRouter } from "next/navigation";

/**
 * Release holds whose pending window elapsed.
 *
 * The board also sweeps on load, so this is mostly a pre-shift button: press it
 * before doors open and every lapsed hold is back on sale for tonight.
 */
export function SweepButton() {
  const router = useRouter();

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={async () => {
        const result = await adminFetch<{ expired: number; releasedSlots: number }>(
          "/api/admin/reservations/sweep",
          { method: "POST" },
        );
        if (!result.ok) {
          toast.error(result.message);
          return;
        }
        toast.success(
          result.data.expired === 0
            ? "No holds needed releasing."
            : `${result.data.expired} hold(s) expired · ${result.data.releasedSlots} slot(s) back on sale.`,
        );
        router.refresh();
      }}
    >
      <TimerReset aria-hidden />
      Release expired holds
    </Button>
  );
}
