"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { adminFetch, handleUnauthenticated, type FieldErrors } from "@/components/admin/api-client";

/**
 * Mutation controls for the admin console.
 *
 * One hook drives every button on every screen, so the behaviour is identical
 * everywhere: disable while in flight, `router.refresh()` so the server-rendered
 * numbers on the page change with the write, a success toast, and — the part
 * that is usually skipped — the server's own message on failure, including
 * per-field errors for forms. A staff member never sees a silent no-op.
 */

export type ActionState = {
  pending: boolean;
  error: string | null;
  fields: FieldErrors;
};

export function useAdminAction<T>(href: string) {
  const router = useRouter();
  const [state, setState] = React.useState<ActionState>({
    pending: false,
    error: null,
    fields: {},
  });
  const mounted = React.useRef(true);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = React.useCallback(
    async (body?: unknown, options: { method?: "POST" | "PATCH" | "PUT" | "DELETE"; silent?: boolean } = {}) => {
      setState({ pending: true, error: null, fields: {} });
      const result = await adminFetch<T>(href, {
        // Explicit: the console PATCHes a booking's details and a guest's profile,
        // and a POST to those routes is a 405 that looks like a dead button.
        method: options.method ?? "POST",
        body,
      });
      if (!mounted.current) return result;

      if (result.ok) {
        setState({ pending: false, error: null, fields: {} });
        if (!options.silent) router.refresh();
        return result;
      }

      if (handleUnauthenticated(result)) return result;
      setState({ pending: false, error: result.message, fields: result.fields });
      return result;
    },
    [href, router],
  );

  const clearError = React.useCallback(() => setState((prev) => ({ ...prev, error: null })), []);

  return { ...state, run, clearError };
}

export function ActionError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-md border border-danger/35 bg-danger/10 px-3 py-2 text-[12.5px] leading-relaxed text-danger"
    >
      <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0">{message}</span>
    </p>
  );
}

/** Simple "do the thing" button: POST, refresh, toast. */
export function ActionButton({
  href,
  payload,
  successMessage,
  children,
  onDone,
  ...buttonProps
}: {
  href: string;
  payload?: unknown;
  successMessage?: string | ((data: Record<string, unknown>) => string);
  children: React.ReactNode;
  onDone?: (data: Record<string, unknown>) => void;
} & Omit<ButtonProps, "onClick">) {
  const action = useAdminAction<Record<string, unknown>>(href);

  return (
    <>
      <Button
        {...buttonProps}
        disabled={buttonProps.disabled || action.pending}
        onClick={async () => {
          const result = await action.run(payload);
          if (!result.ok) {
            toast.error(result.message);
            return;
          }
          if (typeof successMessage === "function") {
            toast.success(successMessage(result.data));
          } else if (successMessage) {
            toast.success(successMessage);
          }
          onDone?.(result.data);
        }}
      >
        {action.pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
        {children}
      </Button>
      {action.error ? <ActionError message={action.error} /> : null}
    </>
  );
}

/**
 * A button that asks for a reason first. Required for anything that touches a
 * guest's evening — "why was this rejected" is the first question a manager
 * asks, and the answer belongs in the reservation's timeline, not in someone's
 * memory.
 */
export function PromptActionButton({
  href,
  label,
  title,
  description,
  reasonLabel = "Reason",
  reasonRequired = false,
  reasonPlaceholder,
  askForReason = true,
  method = "POST",
  payload,
  successMessage,
  triggerVariant = "secondary",
  triggerSize = "sm",
  destructive = false,
  onDone,
}: {
  href: string;
  label: React.ReactNode;
  title: string;
  description?: string;
  /**
   * Whether the dialog collects a reason. Only offer a field the endpoint can
   * actually keep: the DELETE routes retire a row and store nothing, so asking
   * "why is it going?" there would put an answer into the bin.
   */
  askForReason?: boolean;
  /**
   * The verb the route really exports. Retiring a room or a payment entry is a
   * DELETE, and those routes answer a POST with 405 — which in the browser looks
   * exactly like a button that does nothing.
   */
  method?: "POST" | "DELETE";
  reasonLabel?: string;
  reasonRequired?: boolean;
  reasonPlaceholder?: string;
  payload?: (reason: string) => unknown;
  successMessage?: string;
  triggerVariant?: ButtonProps["variant"];
  triggerSize?: ButtonProps["size"];
  destructive?: boolean;
  onDone?: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const action = useAdminAction<Record<string, unknown>>(href);

  React.useEffect(() => {
    if (open) action.clearError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(next) => (action.pending ? undefined : setOpen(next))}>
      <DialogTrigger asChild>
        <Button
          size={triggerSize}
          variant={destructive && !open ? "ghost" : triggerVariant}
          className={destructive ? "hover:border-danger/40 hover:text-danger" : undefined}
        >
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (askForReason && reasonRequired && reason.trim().length < 3) {
              toast.error("Please say why, so the timeline makes sense later.");
              return;
            }
            const body = !askForReason
              ? undefined
              : payload
                ? payload(reason.trim())
                : { reason: reason.trim() || undefined };
            const result = await action.run(body, { method });
            if (!result.ok) return;
            toast.success(successMessage ?? "Done.");
            setReason("");
            setOpen(false);
            onDone?.();
          }}
        >
          {askForReason ? (
            <FormField
              id={`${href.replace(/[^a-z]/gi, "")}-reason`}
            label={reasonLabel}
            required={reasonRequired}
            error={action.fields.reason}
            hint={reasonRequired ? undefined : "Optional, but useful."}
          >
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                maxLength={500}
                placeholder={reasonPlaceholder ?? "Add a note for the timeline…"}
              />
            </FormField>
          ) : null}

          <ActionError message={action.error} />

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={action.pending}>
              Keep as is
            </Button>
            <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={action.pending}>
              {action.pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
              Confirm
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Inline form shell used by the multi-field admin panels (settings, rooms,
 * staff, payments). Keeps the "server owns the errors" contract in one place.
 */
export function AdminForm({
  onSubmit,
  children,
  className,
  submitLabel = "Save",
  pendingLabel = "Saving…",
  disabled,
  error,
}: {
  onSubmit: (done: () => void) => Promise<boolean | void>;
  children: React.ReactNode;
  className?: string;
  submitLabel?: string;
  pendingLabel?: string;
  disabled?: boolean;
  error?: string | null;
}) {
  const [pending, setPending] = React.useState(false);

  return (
    <form
      className={className}
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        const keepOpen = await onSubmit(() => setPending(false));
        if (keepOpen !== false) setPending(false);
      }}
    >
      <fieldset disabled={pending || disabled} className={className ? undefined : "contents"}>
        {children}
        {error ? <ActionError message={error} /> : null}
        <div className="flex items-center gap-2 pt-1">
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
            {pending ? pendingLabel : submitLabel}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
