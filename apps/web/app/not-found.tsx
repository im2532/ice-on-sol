import Link from "next/link";
import Mascot from "@/components/Mascot";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-5 px-4 py-24 text-center">
      <Mascot size={72} mood="sad" />
      <h1 className="text-2xl font-semibold">404 — melted</h1>
      <p className="text-sm text-muted">This page doesn&apos;t exist, or it hasn&apos;t graduated yet.</p>
      <Link href="/" className="icemarkets-btn-primary icemarkets-focus px-5 py-2.5 text-sm">
        Back to markets
      </Link>
    </div>
  );
}
