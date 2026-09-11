"use client";

import { useRef, useState } from "react";
import { toast } from "@/components/Toast";

export interface IdentityState {
  imageUri: string;
  imagePreview: string;
  name: string;
  ticker: string;
  website: string;
  x: string;
  telegram: string;
  description: string;
}

interface Step2Props {
  value: IdentityState;
  onChange: (next: IdentityState) => void;
}

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];

export default function Step2Identity({ value, onChange }: Step2Props) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function set<K extends keyof IdentityState>(key: K, v: IdentityState[K]) {
    onChange({ ...value, [key]: v });
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error("Use a PNG, JPG or WEBP image");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Image must be 5MB or smaller");
      return;
    }
    const preview = URL.createObjectURL(file);
    onChange({ ...value, imagePreview: preview });
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      onChange({ ...value, imagePreview: preview, imageUri: json.uri });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="grid gap-5 sm:grid-cols-[140px_1fr]">
      <div>
        <span className="mb-1.5 block text-xs font-medium text-muted">Image</span>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="icemarkets-focus relative grid h-[140px] w-[140px] place-items-center overflow-hidden rounded-xl border border-dashed border-border bg-surface2 text-xs text-muted hover:border-green/50"
          aria-label="Upload market image"
        >
          {value.imagePreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value.imagePreview} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="px-3 text-center leading-snug">PNG / JPG / WEBP
              <br />≤ 5MB</span>
          )}
          {uploading && (
            <span className="absolute inset-0 grid place-items-center bg-bg/60 text-[11px]">Uploading…</span>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>

      <div className="space-y-3.5">
        <Field label="Name" htmlFor="launch-name">
          <input
            id="launch-name"
            value={value.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Copper Inu"
            maxLength={32}
            className="icemarkets-focus w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Ticker" htmlFor="launch-ticker">
          <input
            id="launch-ticker"
            value={value.ticker}
            onChange={(e) => set("ticker", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            placeholder="COPPERINU"
            maxLength={12}
            className="icemarkets-focus w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm font-nums"
          />
        </Field>
        <div className="grid gap-3.5 sm:grid-cols-3">
          <Field label="Website" htmlFor="launch-website" optional>
            <input
              id="launch-website"
              value={value.website}
              onChange={(e) => set("website", e.target.value)}
              placeholder="https://…"
              className="icemarkets-focus w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="X" htmlFor="launch-x" optional>
            <input
              id="launch-x"
              value={value.x}
              onChange={(e) => set("x", e.target.value)}
              placeholder="@handle"
              className="icemarkets-focus w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Telegram" htmlFor="launch-tg" optional>
            <input
              id="launch-tg"
              value={value.telegram}
              onChange={(e) => set("telegram", e.target.value)}
              placeholder="t.me/…"
              className="icemarkets-focus w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm"
            />
          </Field>
        </div>
        <Field label="Description" htmlFor="launch-desc" optional>
          <textarea
            id="launch-desc"
            value={value.description}
            onChange={(e) => set("description", e.target.value)}
            rows={3}
            maxLength={280}
            placeholder="What is this market about?"
            className="icemarkets-focus w-full resize-none rounded-lg border border-border bg-surface2 px-3 py-2 text-sm"
          />
        </Field>
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  optional,
  children,
}: {
  label: string;
  htmlFor: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-muted">
        {label} {optional && <span className="text-muted/60">(optional)</span>}
      </label>
      {children}
    </div>
  );
}
