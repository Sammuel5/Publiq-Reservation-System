import { formatMoney } from "@/lib/utils/money";

/** Centavos in, pesos out — the same formatter the customer site uses. */
export function Money({
  centavos,
  currency,
  className,
  muted = false,
}: {
  centavos: number;
  currency?: string;
  className?: string;
  muted?: boolean;
}) {
  return (
    <span className={className} data-money={centavos}>
      <span className={muted ? "text-muted" : undefined}>{formatMoney(centavos, currency ? { currency } : {})}</span>
    </span>
  );
}
