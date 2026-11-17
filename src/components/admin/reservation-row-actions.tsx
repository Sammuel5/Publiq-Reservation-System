"use client";

import { Check, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { adminFetch } from "@/components/admin/api-client";
import { PromptActionButton } from "@/components/admin/action-controls";

/**
 * The two decisions that have to be made on every shift: approve a pending
 * request, or let it go. Everything more involved belongs on the detail page.
 */
export function ReservationRowActions({
  id,
  status,
  reference,
  canDecide,
  canStatus,
}: {
  id: string;
  status: string;
  reference: string;
  /** Approve/decline — `reservation:decide`. */
  canDecide: boolean;
  /** Floor actions, including cancelling a hold nobody honoured — `reservation:status`. */
  canStatus: boolean;
}) {
  if (status !== "PENDING") return null;
  if (!canDecide && !canStatus) return null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {canDecide ? (
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            const result = await adminFetch<{ message: string }>(`/api/admin/reservations/${id}/action`, {
              method: "POST",
              body: { action: "CONFIRM" },
            });
            toast[result.ok ? "success" : "error"](result.ok ? (result.data.message ?? "Confirmed.") : result.message);
          }}
        >
          <Check aria-hidden />
          Confirm
        </Button>
      ) : null}
      <PromptActionButton
        href={`/api/admin/reservations/${id}/action`}
        label={
          <>
            <XCircle aria-hidden />
            {canDecide ? "Decline" : "Release hold"}
          </>
        }
        title={canDecide ? `Decline ${reference}?` : `Release the hold on ${reference}?`}
        description="The space is released straight away, so another guest can take the slot. Say why — the guest may call back."
        reasonLabel="Reason (goes on the booking)"
        reasonRequired
        payload={(reason) => ({ action: canDecide ? "REJECT" : "CANCEL", reason })}
        successMessage={canDecide ? "Request declined and the room released." : "Hold released and the room back on sale."}
        triggerVariant="ghost"
        destructive
      />
    </div>
  );
}
