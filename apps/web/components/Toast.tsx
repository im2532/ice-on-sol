"use client";

import { useEffect, useState } from "react";

type ToastKind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

type Listener = (items: ToastItem[]) => void;
let items: ToastItem[] = [];
let listeners: Listener[] = [];
let nextId = 1;

function emit() {
  listeners.forEach((l) => l(items));
}

function push(kind: ToastKind, message: string) {
  const id = nextId++;
  items = [...items, { id, kind, message }];
  emit();
  setTimeout(() => {
    items = items.filter((i) => i.id !== id);
    emit();
  }, 4500);
}

export const toast = {
  success: (message: string) => push("success", message),
  error: (message: string) => push("error", message),
  info: (message: string) => push("info", message),
};

const KIND_STYLE: Record<ToastKind, string> = {
  success: "text-positive",
  error: "text-negative",
  info: "text-text",
};

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>([]);
  useEffect(() => {
    listeners.push(setList);
    return () => {
      listeners = listeners.filter((l) => l !== setList);
    };
  }, []);

  return (
    <div
      className="fixed bottom-[100px] right-4 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2 md:bottom-4"
      aria-live="polite"
      role="status"
    >
      {list.map((t) => (
        <div
          key={t.id}
          className={`glass-strong animate-toast-in px-4 py-3 text-sm ${KIND_STYLE[t.kind]}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
