"use client";
import { TabGroup, Tab } from "@/components/agentic/TabGroup";
export default function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  fullWidth,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (value: T) => void;
  fullWidth?: boolean;
}) {
  return (
    <TabGroup
      style="rounded"
      ariaLabel={label}
      activeIndex={options.findIndex((o) => o.value === value)}
      fullWidth={fullWidth}
      onChange={(i) => onChange(options[i].value)}
    >
      {options.map((o) => (
        <Tab key={o.value} disabled={o.disabled}>
          {o.label}
        </Tab>
      ))}
    </TabGroup>
  );
}
