"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2, Plus, ShieldAlert, Unlock } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActionError } from "@/components/admin/action-controls";
import { adminFetch, type FieldErrors } from "@/components/admin/api-client";
import { PERMISSIONS_BY_ROLE, ROLE_LABELS } from "@/components/admin/_role-labels";

/**
 * Staff accounts.
 *
 * The console deliberately shows *what a role can do* next to the role picker:
 * the difference between Staff and Admin here is the ability to edit a booking
 * or delete a room, and a Super Admin clicking a dropdown should see that
 * consequence rather than a label.
 *
 * Deactivating an account or resetting its password revokes its sessions
 * immediately — the server owns session state, so logging someone out is a
 * database write, not a wait for a cookie to expire.
 */

type User = {
  id: string;
  name: string;
  email: string;
  role: "SUPER_ADMIN" | "ADMIN" | "STAFF";
  roleLabel: string;
  isActive: boolean;
  lastLoginLabel: string | null;
  openSessions: number;
  lockedUntil: string | null;
  passwordChangedAt: string | null;
  isSelf: boolean;
};

type Session = {
  id: string;
  lastSeenAt: string;
  expiresAt: string;
  active: boolean;
  device: string | null;
  ip: string | null;
};

export function TeamAdmin({ users, timezone }: { users: User[]; timezone: string }) {
  // Staff rows come from the server, so each write below asks for the tree again.
  const router = useRouter();
  void timezone;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px] leading-relaxed text-muted">
          Staff sign in with these accounts. Passwords are hashed with bcrypt (cost 12) and sessions are
          stored as one-way hashes, so a database leak cannot be replayed as a login.
        </p>
        <AccountDialog />
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sessions</TableHead>
              <TableHead className="text-right">Manage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id} data-account={user.email}>
                <TableCell>
                  <span className="block text-[13.5px] font-medium">{user.name}</span>
                  <span className="block text-[12px] text-faint">{user.email}</span>
                  {user.isSelf ? <Badge variant="gold" className="mt-1">You</Badge> : null}
                </TableCell>
                <TableCell>
                  <span className="block text-[13px]">{ROLE_LABELS[user.role]}</span>
                  <span className="block max-w-[220px] text-[11.5px] leading-relaxed text-faint">
                    {PERMISSIONS_BY_ROLE[user.role]}
                  </span>
                </TableCell>
                <TableCell>
                  {user.isActive ? (
                    <Badge variant="success">Active</Badge>
                  ) : (
                    <Badge variant="outline">Disabled</Badge>
                  )}
                  {user.lockedUntil ? (
                    <Badge variant="danger" className="ml-1.5">
                      Locked
                    </Badge>
                  ) : null}
                  <span className="mt-1 block text-[11.5px] text-faint">
                    {user.lastLoginLabel ? `Last seen ${user.lastLoginLabel}` : "Never signed in"}
                  </span>
                </TableCell>
                <TableCell>
                  <SessionsDialog user={user} />
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {user.lockedUntil ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          const result = await adminFetch(`/api/admin/team/${user.id}`, {
                            method: "POST",
                            body: { action: "unlock" },
                          });
                          toast[result.ok ? "success" : "error"](
                            result.ok ? "Lockout cleared." : result.message,
                          );
                          if (result.ok) router.refresh();
                        }}
                      >
                        <Unlock aria-hidden />
                        Unlock
                      </Button>
                    ) : null}
                    <PasswordDialog user={user} />
                    <Button
                      size="sm"
                      variant={user.isActive ? "ghost" : "secondary"}
                      disabled={user.isSelf && user.isActive}
                      title={user.isSelf && user.isActive ? "You cannot deactivate the account you are using" : undefined}
                      onClick={async () => {
                        const result = await adminFetch<{ sessionsRevoked: number }>(
                          `/api/admin/team/${user.id}`,
                          { method: "PATCH", body: { isActive: !user.isActive } },
                        );
                        if (!result.ok) {
                          toast.error(result.message);
                          return;
                        }
                        toast.success(
                          user.isActive
                            ? `Account disabled · ${result.data.sessionsRevoked} session(s) revoked.`
                            : "Account re-enabled.",
                        );
                        router.refresh();
                      }}
                    >
                      {user.isActive ? "Disable" : "Enable"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function AccountDialog() {
  // Staff rows come from the server, so each write below asks for the tree again.
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fields, setFields] = React.useState<FieldErrors>({});
  const [form, setForm] = React.useState({ name: "", email: "", role: "STAFF", password: "" });

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setError(null);
          setFields({});
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus aria-hidden />
          Add account
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New staff account</DialogTitle>
          <DialogDescription>
            Give the person the password once, in hand. It is never stored in plain text and never shown
            again here.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            const result = await adminFetch<{ email: string }>("/api/admin/team", {
              method: "POST",
              body: form,
            });
            setPending(false);
            if (!result.ok) {
              setError(result.message);
              setFields(result.fields);
              return;
            }
            toast.success(`${result.data.email} can sign in now.`);
            setOpen(false);
            router.refresh();
            setForm({ name: "", email: "", role: "STAFF", password: "" });
          }}
        >
          <FormField id="account-name" label="Name" error={fields.name} required>
            <Input id="account-name" value={form.name} onChange={update("name")} maxLength={120} />
          </FormField>
          <FormField id="account-email" label="Email" error={fields.email} required>
            <Input id="account-email" type="email" value={form.email} onChange={update("email")} />
          </FormField>
          <FormField id="account-role" label="Role" error={fields.role}>
            <select
              id="account-role"
              className="min-h-10 w-full rounded-md border border-line bg-surface px-3 text-[13.5px] text-foreground focus-visible:border-gold/60 focus-visible:outline-none"
              value={form.role}
              onChange={update("role")}
            >
              <option value="STAFF">Staff — floor actions only</option>
              <option value="ADMIN">Admin — bookings, spaces, settings</option>
              <option value="SUPER_ADMIN">Super Admin — everything, including staff</option>
            </select>
          </FormField>
          <FormField
            id="account-password"
            label="Temporary password"
            hint="12+ chars, upper, lower, number, symbol"
            error={fields.password}
            required
          >
            <Input id="account-password" value={form.password} onChange={update("password")} autoComplete="new-password" />
          </FormField>

          {error ? <ActionError message={error} /> : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
              Create account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PasswordDialog({ user }: { user: User }) {
  // Staff rows come from the server, so each write below asks for the tree again.
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fields, setFields] = React.useState<FieldErrors>({});
  const [password, setPassword] = React.useState("");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setError(null);
          setFields({});
          setPassword("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <KeyRound aria-hidden />
          Reset password
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New password for {user.name}</DialogTitle>
          <DialogDescription>
            Their current sessions are revoked the moment you save, so a departed staff member cannot keep
            working from a stolen laptop.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            const result = await adminFetch<{ sessionsRevoked: number }>(`/api/admin/team/${user.id}`, {
              method: "PATCH",
              body: { password },
            });
            setPending(false);
            if (!result.ok) {
              setError(result.message);
              setFields(result.fields);
              return;
            }
            toast.success(`Password reset · ${result.data.sessionsRevoked} session(s) revoked.`);
            setOpen(false);
            router.refresh();
          }}
        >
          <FormField
            id={`pw-${user.id}`}
            label="New password"
            hint="12+ chars, mixed case, number, symbol, no spaces"
            error={fields.password}
            required
          >
            <Input id={`pw-${user.id}`} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
          </FormField>
          {error ? <ActionError message={error} /> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={pending || password.length < 12}>
              {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
              Reset password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SessionsDialog({ user }: { user: User }) {
  // Staff rows come from the server, so each write below asks for the tree again.
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [sessions, setSessions] = React.useState<Session[] | null>(null);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const result = await adminFetch<{ sessions: Session[] }>(`/api/admin/team/${user.id}`);
    setLoading(false);
    if (result.ok) setSessions(result.data.sessions);
    else toast.error(result.message);
  }, [user.id]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          {user.openSessions} open
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Sessions · {user.name}</DialogTitle>
          <DialogDescription>
            One row per signed-in device. Revoking forces that device to sign in again.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="flex items-center gap-2 text-[13px] text-muted">
            <Loader2 aria-hidden className="animate-spin" />
            Loading…
          </p>
        ) : !sessions || sessions.length === 0 ? (
          <p className="text-[13px] text-muted">No sessions recorded for this account.</p>
        ) : (
          <ul className="space-y-2">
            {sessions.map((session) => (
              <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface/60 px-3 py-2">
                <span className="min-w-0">
                  <span className="block text-[13px]">
                    {session.device ?? "Unknown device"}{" "}
                    {session.active ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="outline">Ended</Badge>
                    )}
                  </span>
                  <span className="block text-[11.5px] text-faint">
                    last seen {new Date(session.lastSeenAt).toLocaleString("en-PH")}
                    {session.ip ? ` · ${session.ip}` : ""}
                  </span>
                </span>
                {session.active ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      const result = await adminFetch(`/api/admin/team/${user.id}`, {
                        method: "POST",
                        body: { action: "revoke-session", sessionId: session.id },
                      });
                      if (!result.ok) {
                        toast.error(result.message);
                        return;
                      }
                      toast.success("Session revoked.");
                      await load();
                      router.refresh();
                    }}
                  >
                    <ShieldAlert aria-hidden />
                    Revoke
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
