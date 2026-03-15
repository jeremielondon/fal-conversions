import { NextRequest, NextResponse } from "next/server";
import { loginResponse } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const { password } = await request.json();
  if (password !== process.env.DASHBOARD_PASSWORD) {
    return NextResponse.json({ error: "Mot de passe incorrect" }, { status: 401 });
  }
  return loginResponse();
}
