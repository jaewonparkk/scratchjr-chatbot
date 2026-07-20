import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const { count, error } = await supabaseAdmin
      .from("documents")
      .select("*", {
        count: "exact",
        head: true,
      });

    if (error) {
      throw error;
    }

    return NextResponse.json({
      status: "ok",
      database: "connected",
      documentCount: count ?? 0,
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    return NextResponse.json(
      {
        status: "error",
        database: "disconnected",
      },
      {
        status: 500,
      },
    );
  }
}