import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await prisma.runLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 120,
    select: { id: true, level: true, scope: true, message: true, createdAt: true },
  });
  return NextResponse.json({ entries: rows.reverse() });
}
