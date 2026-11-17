import * as React from "react";
import { cn } from "@/lib/utils/cn";
import { Label } from "@/components/ui/label";

/**
 * FormField — label + control + hint/error wiring used by every form.
 *
 * Two ways to use it:
 *
 * 1) Direct control (most fields) — the props are injected onto the child:
 *      <FormField id="email" label="Email" error={errors.email}>
 *        <Input type="email" />
 *      </FormField>
 *
 * 2) Render prop (fields with wrappers, e.g. a password input + reveal button) —
 *    the callback receives the exact a11y attributes to spread on the control,
 *    so the `id`/`aria-*` never land on a wrapper element:
 *      <FormField id="password" label="Password" error={errors.password}>
 *        {(control) => (
 *          <div className="relative">
 *            <Input {...control} type="password" />
 *            <button type="button">…</button>
 *          </div>
 *        )}
 *      </FormField>
 */

export type FieldControlProps = {
  id: string;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
  "aria-required": true | undefined;
};

export function FormField({
  id,
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode | ((control: FieldControlProps) => React.ReactNode);
  className?: string;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  const controlProps: FieldControlProps = {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": [hintId, errorId].filter(Boolean).join(" ") || undefined,
    "aria-required": required ? true : undefined,
  };

  let control: React.ReactNode;

  if (typeof children === "function") {
    control = children(controlProps);
  } else if (React.isValidElement(children)) {
    control = React.cloneElement(
      children as React.ReactElement<Record<string, unknown>>,
      controlProps,
    );
  } else {
    control = children;
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>
          {label}
          {required ? (
            <span aria-hidden className="ml-1 text-gold">
              *
            </span>
          ) : null}
        </Label>
        {hint ? (
          <span id={hintId} className="text-xs text-faint">
            {hint}
          </span>
        ) : null}
      </div>

      {control}

      {error ? (
        <p id={errorId} role="alert" className="text-[13px] font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
