import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { requireAdmin } from "@/lib/auth/guards";
import { ADMIN_ROLE_LABELS } from "@/config/app";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function ForbiddenPage({
  searchParams,
}: {
  searchParams: Promise<{ permission?: string }>;
}) {
  const session = await requireAdmin();
  const { permission } = await searchParams;

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center text-center">
      <div className="mb-5 grid size-14 place-items-center rounded-full border border-warning/30 bg-warning/10">
        <ShieldAlert aria-hidden className="size-6 text-warning" />
      </div>
      <h2 className="text-xl font-semibold tracking-tight">Not available for your role</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Your account is signed in as{" "}
        <Badge variant="gold">{ADMIN_ROLE_LABELS[session.user.role]}</Badge> and does not
        include the permission needed for this page
        {permission ? (
          <>
            {" "}
            (<code className="font-mono text-[12px] text-gold">{permission}</code>)
          </>
        ) : null}
        . Ask a Super Admin if you need access.
      </p>
      <Button asChild variant="secondary" className="mt-6">
        <Link href="/admin">Back to dashboard</Link>
      </Button>
    </div>
  );
}
