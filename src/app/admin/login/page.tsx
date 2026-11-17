import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentAdmin } from "@/lib/auth/guards";
import { getClubSettings } from "@/lib/services/club-settings";
import { PubliqLogo } from "@/components/brand/publiq-logo";
import { LoginForm } from "@/components/admin/login-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin sign-in",
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage() {
  const session = await getCurrentAdmin();
  if (session) redirect("/admin");

  const settings = await getClubSettings().catch(() => null);

  return (
    <main
      id="main-content"
      className="grid min-h-dvh grid-cols-1 lg:grid-cols-[1.05fr_1fr]"
    >
      {/* Brand panel — hidden on phones to keep the form above the fold */}
      <section className="relative hidden overflow-hidden border-r border-line bg-surface lg:block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/publiq-venue/venue-9.jpeg" alt="" aria-hidden="true" className="absolute inset-0 size-full object-cover" />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black via-black/85 to-black/70" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <div className="flex items-center gap-5">
            <PubliqLogo className="w-32" />
            <div>
              <p className="text-sm font-semibold">{settings?.clubName ?? "PUBLIQ"}</p>
              <p className="text-[11px] uppercase tracking-[0.2em] text-faint">Management Console</p>
            </div>
          </div>

          <div className="max-w-md">
            <div className="gold-rule mb-8 w-24" />
            <h1 className="font-display text-4xl font-semibold uppercase leading-tight tracking-tight">
              Run the floor
              <span className="block text-gold-gradient">with certainty.</span>
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-muted">
              A dedicated workspace for the club team to review bookings and manage the night.
            </p>
          </div>

          <p className="text-[11px] uppercase tracking-[0.18em] text-faint">
            Authorised personnel only
          </p>
        </div>
      </section>

      {/* Form panel */}
      <section className="flex items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <PubliqLogo className="w-28" />
          </div>

          <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1.5 text-sm text-muted">
            Use your club staff account. Access is logged.
          </p>

          <LoginForm />
        </div>
      </section>
    </main>
  );
}
