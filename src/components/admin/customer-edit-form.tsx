"use client";

import * as React from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ActionError, AdminForm } from "@/components/admin/action-controls";
import { useAdminAction } from "@/components/admin/action-controls";

/**
 * Guest profile edits.
 *
 * The mobile number is deliberately *not* editable here: it is the identity key
 * that links this guest's bookings together, so changing it belongs on the
 * reservation itself (where the idempotency key is recomputed in the same
 * operation), not on the profile.
 */
export function CustomerEditForm({
  customerId,
  customer,
  canEdit,
}: {
  customerId: string;
  customer: { fullName: string; mobile: string; email: string; notes: string };
  canEdit: boolean;
}) {
  const action = useAdminAction<{ changed: string[] }>(`/api/admin/customers/${customerId}`);
  const [form, setForm] = React.useState({
    fullName: customer.fullName,
    email: customer.email,
    notes: customer.notes,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[15px]">Profile</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">Mobile (identity)</p>
          <p className="text-[13.5px]">{customer.mobile}</p>
        </div>

        {canEdit ? (
          <AdminForm
            submitLabel="Save profile"
            error={action.error}
            onSubmit={async () => {
              const result = await action.run(form, { method: "PATCH" });
              if (!result.ok) return;
              if (result.data.changed?.length) toast.success(`Updated ${result.data.changed.join(", ")}.`);
              else toast.info("Nothing changed.");
            }}
          >
            <div className="space-y-4">
              <FormField id="cust-name" label="Display name" error={action.fields.fullName}>
                <Input
                  id="cust-name"
                  value={form.fullName}
                  maxLength={120}
                  onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))}
                />
              </FormField>
              <FormField id="cust-email" label="Email" error={action.fields.email}>
                <Input
                  id="cust-email"
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                />
              </FormField>
              <FormField id="cust-notes" label="House notes" hint="Staff only" error={action.fields.notes}>
                <Textarea
                  id="cust-notes"
                  rows={3}
                  maxLength={1000}
                  value={form.notes}
                  placeholder="Prefers a quiet corner. Always pays by GCash."
                  onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                />
              </FormField>
              {action.error ? <ActionError message={action.error} /> : null}
            </div>
          </AdminForm>
        ) : (
          <div className="space-y-1.5 text-[13.5px]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">Email</p>
            <p>{customer.email || "—"}</p>
            <p className="pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">House notes</p>
            <p className="leading-relaxed text-muted">{customer.notes || "None"}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
