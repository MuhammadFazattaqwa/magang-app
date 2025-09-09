import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("technicians")
    .select("id, code, name, initials")
    .order("code", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    data: (data ?? []).map((t) => ({
      id: t.id,            // UUID DB
      code: t.code,        // kode unik teknisi
      name: t.name,
      initial: (t.initials ?? (t.name?.[0] ?? "?")).toUpperCase(), // disesuaikan ke 'initial'
    })),
    idle: [], // placeholder (UI tidak pakai saat ini)
  });
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const technicianId = searchParams.get('id');

    if (!technicianId) {
      return NextResponse.json({ error: "ID teknisi diperlukan" }, { status: 400 });
    }

    // Hapus teknisi dari database
    const { error } = await supabaseAdmin
      .from("technicians")
      .delete()
      .eq("id", technicianId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ message: "Teknisi berhasil dihapus" });
  } catch (error) {
    return NextResponse.json({ error: "Terjadi kesalahan saat menghapus teknisi" }, { status: 500 });
  }
}
