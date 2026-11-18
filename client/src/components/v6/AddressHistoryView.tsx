import { useLocale } from "@/contexts/LocaleContext";
import type { AddressEntry } from "@shared/address-history";

/**
 * Two small tables: what they called the user, and what the user called them.
 *
 * The numbers are counts per quarter. Nothing here is inferred.
 */
export default function AddressHistoryView({ history }: { history: AddressEntry[] }) {
  const { t } = useLocale();
  const them = history.filter((entry) => entry.direction === "them_to_me");
  const me = history.filter((entry) => entry.direction === "me_to_them");
  if (them.length === 0 && me.length === 0) return null;
  return (
    <section className="space-y-4">
      <h2 className="section-title">{t("profile.address")}</h2>
      {them.length > 0 ? (
        <AddressTable title={t("profile.addressThem")} rows={them} />
      ) : null}
      {me.length > 0 ? (
        <AddressTable title={t("profile.addressMe")} rows={me} />
      ) : null}
    </section>
  );
}

function AddressTable({ title, rows }: { title: string; rows: AddressEntry[] }) {
  const quarters = [...new Set(rows.flatMap((row) => Object.keys(row.byQuarter)))].sort();
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-foreground/80">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-muted-foreground">
          <thead>
            <tr>
              <th className="text-left font-medium pr-3 py-1">{title}</th>
              {quarters.map((quarter) => (
                <th key={quarter} className="text-right font-medium px-1 py-1">
                  {quarter}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.direction}:${row.form}`}>
                <td className="pr-3 py-1 text-foreground">{row.form}</td>
                {quarters.map((quarter) => (
                  <td key={quarter} className="text-right px-1 py-1">
                    {row.byQuarter[quarter] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
