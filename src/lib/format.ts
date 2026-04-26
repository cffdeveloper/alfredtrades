export const fmtUSD = (v: number, frac = 2) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
  }).format(v);

export const fmtPct = (v: number, frac = 2) =>
  `${v >= 0 ? "+" : ""}${v.toFixed(frac)}%`;

export const fmtTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};
