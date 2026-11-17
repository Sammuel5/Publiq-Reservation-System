"use client";

import * as React from "react";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Alert } from "@/components/ui/alert";
import { loginSchema } from "@/lib/validation/auth";
import { fieldErrorsFromZod } from "@/lib/validation/form-errors";

type FieldErrors = { email?: string; password?: string };
type Cooldown = { until: number; scope: "ip" | "email" | "account"; email?: string };
const COOLDOWN_KEY = "publiq-login-cooldown";

function secondsLeft(until: number, now: number) {
  return Math.max(0, Math.ceil((until - now) / 1000));
}

function formatCountdown(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}


export function LoginForm() {
  const [hydrated, setHydrated] = React.useState(false);
  React.useEffect(() => { setHydrated(true); }, []);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [cooldowns, setCooldowns] = React.useState<Cooldown[]>([]);
  const [now, setNow] = React.useState(0);
  const [ready, setReady] = React.useState(false);

  // Keep active countdowns in this tab. Email-specific timers follow the
  // submitted address; only a network quota applies to other accounts.
  // Passwords are never stored. The server remains authoritative.
  React.useEffect(() => {
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(COOLDOWN_KEY) ?? "null");
      const current = Date.now();
      const entries = Array.isArray(saved) ? saved : [];
      const valid = entries.filter((value): value is Cooldown => {
        if (!value || typeof value !== "object") return false;
        const item = value as Cooldown;
        return Number.isFinite(item.until) && item.until > current && item.until <= current + 86_400_000 &&
          (item.scope === "ip" || ((item.scope === "email" || item.scope === "account") && typeof item.email === "string"));
      });
      setNow(current);
      setCooldowns(valid);
      const latestAddress = [...valid].reverse().find((entry) => entry.email)?.email;
      if (latestAddress) setEmail(latestAddress);
      // Old unscoped countdowns cannot be tied to an account safely.
      sessionStorage.setItem(COOLDOWN_KEY, JSON.stringify(valid));
    } catch { /* Storage may be disabled; sign-in still works. */ }
  }, []);

  React.useEffect(() => {
    if (!cooldowns.length) return;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      const alive = cooldowns.filter((entry) => entry.until > current);
      if (alive.length !== cooldowns.length) {
        const expiredForCurrent = cooldowns.some((entry) => entry.until <= current &&
          (entry.scope === "ip" || entry.email === email.trim().toLowerCase()));
        setCooldowns(alive);
        if (expiredForCurrent) setReady(true);
        try { sessionStorage.setItem(COOLDOWN_KEY, JSON.stringify(alive)); } catch { /* optional storage */ }
      }
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [cooldowns, email]);

  const normalizedEmail = email.trim().toLowerCase();
  const cooldown = cooldowns.filter((entry) => entry.scope === "ip" || entry.email === normalizedEmail)
    .sort((a, b) => b.until - a.until)[0] ?? null;
  const remaining = cooldown && now ? secondsLeft(cooldown.until, now) : 0;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cooldown && Date.now() < cooldown.until) return;
    setReady(false);
    setFormError(null);

    // Client-side validation mirrors the server schema; the server re-validates.
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      // First issue per field only — see fieldErrorsFromZod.
      const errors = fieldErrorsFromZod(parsed.error);
      setFieldErrors({ email: errors.email, password: errors.password });
      return;
    }
    setFieldErrors({});
    setSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
        credentials: "same-origin",
      });

      const payload = (await response.json().catch(() => null)) as
        | { user?: { name: string }; error?: { message?: string } }
        | null;

      if (!response.ok) {
        const seconds = Number(response.headers.get("Retry-After"));
        if ((response.status === 429 || response.status === 423) && Number.isInteger(seconds) && seconds > 0 && seconds <= 86_400) {
          const current = Date.now();
          const headerScope = response.headers.get("X-Login-Limit-Scope");
          const scope: Cooldown["scope"] = response.status === 423 ? "account" : headerScope === "email" ? "email" : "ip";
          const next: Cooldown = { until: current + seconds * 1000, scope, ...(scope !== "ip" ? { email: parsed.data.email.toLowerCase().trim() } : {}) };
          const updated = [...cooldowns.filter((entry) => entry.until > current && !(entry.scope === scope && entry.email === next.email)), next];
          setNow(current);
          setCooldowns(updated);
          try { sessionStorage.setItem(COOLDOWN_KEY, JSON.stringify(updated)); } catch { /* optional storage */ }
          return;
        }
        setFormError(
          payload?.error?.message ?? "We could not sign you in. Please try again.",
        );
        return;
      }

      // Force a fresh document request after the session cookie is set. This
      // avoids a cached unauthenticated router state and always opens the dashboard.
      window.location.replace("/admin");
    } catch {
      setFormError("Network error. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form method="post" action="/api/auth/login" onSubmit={handleSubmit} className="mt-7 space-y-4" noValidate>
      {!hydrated ? <p role="status" className="rounded-md border border-line p-3 text-sm text-muted">Loading secure sign-in. If this message remains, enable JavaScript and check your connection.</p> : null}
      {cooldown && remaining > 0 ? (
        <div className="rounded-md border border-gold/30 bg-gold/8 p-4 text-foreground" role="alert">
          <p className="text-sm font-semibold">{cooldown.scope === "account" ? "Account temporarily locked" : cooldown.scope === "email" ? "Too many attempts for this email" : "Too many attempts from this network"}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">{cooldown.scope === "ip" ? "This network is temporarily limited, including other accounts using it." : "This wait applies to the email entered. You can try a different account."}</p>
          <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-gold/20 pt-3">
            <span className="text-[13px] text-muted">Time remaining</span>
            <span className="font-mono text-2xl font-semibold tabular-nums tracking-tight text-gold" aria-live="off" aria-label={`${Math.floor(remaining / 60)} minutes and ${remaining % 60} seconds remaining`} data-testid="login-countdown">
              {formatCountdown(remaining)}
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-faint">Minutes:seconds. Another security limit may require additional waiting.</p>
        </div>
      ) : null}
      {ready && !cooldown ? <p role="status" className="rounded-md border border-success/30 bg-success/8 p-3 text-sm text-[#c9f5d7]">You can try signing in again.</p> : null}
      {formError ? (
        <Alert tone="danger" role="alert" title="Sign-in failed">
          {formError}
        </Alert>
      ) : null}

      <FormField id="email" label="Email address" required error={fieldErrors.email}>
        <Input
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          placeholder="you@club.com"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setReady(false);
            setFormError(null);
            if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: undefined }));
          }}
          disabled={submitting}
        />
      </FormField>

      <FormField id="password" label="Password" required error={fieldErrors.password}>
        {(control) => (
          <div className="relative">
            <Input
              {...control}
              type={showPassword ? "text" : "password"}
              name="password"
              autoComplete="current-password"
              placeholder="••••••••••••"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                if (fieldErrors.password) {
                  setFieldErrors((prev) => ({ ...prev, password: undefined }));
                }
              }}
              disabled={submitting}
              className="pr-12"
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="absolute right-1 top-1 grid size-9 place-items-center rounded-md text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        )}
      </FormField>

      <Button type="submit" className="w-full" size="lg" loading={submitting} disabled={!hydrated || Boolean(cooldown && remaining > 0)}>
        {submitting ? "Signing in" : "Sign in"}
        {!submitting ? <LogIn className="size-4" /> : null}
      </Button>

      <p className="pt-1 text-center text-[12px] leading-relaxed text-faint">
        Accounts are issued by a Super Admin. There is no public registration.
      </p>
    </form>
  );
}
