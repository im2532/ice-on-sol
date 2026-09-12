import type { ReactNode } from "react";
import styles from "@/components/markets/MarketsDashboard.module.css";
export default function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className={styles.pageHeading}>
      <div>
        <span className={styles.eyebrow}>{eyebrow}</span>
        <h1>{title}</h1>
        <p className="max-w-2xl">{description}</p>
      </div>
      {action}
    </header>
  );
}
export function PageStats({
  items,
}: {
  items: { label: string; value: string; note: string }[];
}) {
  return (
    <section className="page-stats" aria-label="Overview">
      {items.map((item) => (
        <div key={item.label}>
          <span className="eyebrow">{item.label}</span>
          <strong>{item.value}</strong>
          <small>{item.note}</small>
        </div>
      ))}
    </section>
  );
}
