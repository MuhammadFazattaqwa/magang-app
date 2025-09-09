import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

export async function GET() {
  try {
    const dir = path.join(process.cwd(), "public", "report-templates");
    const files = await fs.readdir(dir);
    const docx = files
      .filter((f) => f.toLowerCase().endsWith(".docx"))
      .sort((a, b) => a.localeCompare(b, "id"));

    const toLabel = (filename: string) =>
      filename.replace(/_/g, " ").replace(/\.docx$/i, "");

    // value = nama file, label = versi rapi untuk ditampilkan
    const items = docx.map((f) => ({ value: f, label: toLabel(f) }));
    return NextResponse.json({ items });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ items: [] }, { status: 200 });
  }
}
