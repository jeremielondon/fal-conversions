import { NextRequest, NextResponse } from "next/server";
import { getStripeData } from "@/lib/stripe";
import { checkAuth, unauthorizedResponse } from "@/lib/auth";

export async function GET(request: NextRequest) {
  if (!(await checkAuth())) return unauthorizedResponse();

  const { searchParams } = request.nextUrl;
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 864e5)
    .toISOString()
    .slice(0, 10);
  const startDate = searchParams.get("start") || thirtyDaysAgo;
  const endDate = searchParams.get("end") || today;

  try {
    const data = await getStripeData(startDate, endDate);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Stripe API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch Stripe data" },
      { status: 500 }
    );
  }
}
