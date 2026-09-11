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

export const EMPTY_IDENTITY: IdentityState = {
  imageUri: "",
  imagePreview: "",
  name: "",
  ticker: "",
  website: "",
  x: "",
  telegram: "",
  description: "",
};

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** Step 2: image dropzone, name, ticker and the three optional links. */
export default function IdentityFields({
  value,
  onChange,
}: {
  value: IdentityState;
  onChange: (next: IdentityState) => void;
}) {
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
    <section className="glass flex flex-col gap-3.5 p-5 sm:px-[22px]" aria-labelledby="launch-identity-heading">
      <div className="flex items-center gap-2.5">
        <span className="step-badge" style={{ background: "rgba(153,69,255,0.2)", color: "#C9B6FF" }}>
          2
        </span>
        <h2 id="launch-identity-heading" className="display text-base font-semibold">
          Identity
        </h2>
      </div>

      <div className="grid gap-3 sm:grid-cols-[96px_1fr_1fr] sm:items-start">
        <div className="flex flex-col gap-1.5">
          <span className="sr-only">Image</span>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            aria-label="Upload the market image"
            className="tap relative grid h-24 w-24 place-items-center gap-1.5 overflow-hidden rounded-2xl border border-dashed border-white/20 transition-colors hover:border-positive/50"
          >
            {value.imagePreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={value.imagePreview} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex flex-col items-center gap-1.5">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8B90A6" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 16V4M6 10l6-6 6 6M4 20h16" />
                </svg>
                <span className="mono text-[10px] text-muted">image</span>
              </span>
            )}
            {uploading && (
              <span className="mono absolute inset-0 grid place-items-center bg-black/60 text-[11px]">
                Uploading…
              </span>
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

        <Field label="Name" htmlFor="launch-name">
          <input
            id="launch-name"
            value={value.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Goldfish"
            maxLength={32}
            className="field bg-transparent outline-none"
          />
        </Field>

        <Field label="Ticker" htmlFor="launch-ticker">
          <input
            id="launch-ticker"
            value={value.ticker}
            onChange={(e) => set("ticker", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            placeholder="GOLDFISH"
            maxLength={12}
            className="field mono bg-transparent outline-none"
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Website" htmlFor="launch-website">
          <input id="launch-website" value={value.website} onChange={(e) => set("website", e.target.value)} placeholder="https://" className="field bg-transparent outline-none" />
        </Field>
        <Field label="X" htmlFor="launch-x">
          <input id="launch-x" value={value.x} onChange={(e) => set("x", e.target.value)} placeholder="@handle" className="field bg-transparent outline-none" />
        </Field>
        <Field label="Telegram" htmlFor="launch-tg">
          <input id="launch-tg" value={value.telegram} onChange={(e) => set("telegram", e.target.value)} placeholder="t.me/" className="field bg-transparent outline-none" />
        </Field>
      </div>

      <Field label="Description" htmlFor="launch-desc">
        <textarea
          id="launch-desc"
          value={value.description}
          onChange={(e) => set("description", e.target.value)}
          rows={3}
          maxLength={280}
          placeholder="What is this market about?"
          className="field resize-none bg-transparent py-3 outline-none"
          style={{ alignItems: "flex-start" }}
        />
      </Field>
    </section>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-semibold text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}
