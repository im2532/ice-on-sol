"use client";
import type { ComponentProps } from "react";
import { Input } from "@/components/agentic/Input";
import { Icon } from "@/components/agentic/Icon/Icon";
import styles from "@/components/markets/MarketsDashboard.module.css";

export default function SearchField(props: ComponentProps<typeof Input>) {
  return <div className={styles.search}><Icon name="search" /><Input {...props} type="search" /></div>;
}
