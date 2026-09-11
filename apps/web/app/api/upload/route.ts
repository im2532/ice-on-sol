import { NextRequest, NextResponse } from "next/server";

/**
 * Irys stub. Real implementation uploads the launch image + metadata JSON to Irys (bundlr) using
 * IRYS_PRIVATE_KEY_PATH (see .env.example) and returns the permanent arweave.net URI. For now this
 * validates the upload client-side contract (≤5MB, png/jpg/webp) and echoes a data URL so /launch works
 * end to end without network access.
 */
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: "Only PNG, JPG or WEBP images are accepted" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Image must be 5MB or smaller" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const dataUri = `data:${file.type};base64,${buf.toString("base64")}`;

  // TODO(irys): swap this for a real @irys/sdk upload once IRYS_PRIVATE_KEY_PATH is provisioned.
  return NextResponse.json({ uri: dataUri, provider: "stub" });
}
