import { NextRequest, NextResponse } from "next/server";
import { getAnalyticsData } from "@/lib/analytics";
import { checkAuth, unauthorizedResponse } from "@/lib/auth";

export async function GET(request: NextRequest) {
  if (!(await checkAuth())) return unauthorizedResponse();

  const { searchParams } = request.nextUrl;
  const startDate = searchParams.get("start") || "30daysAgo";
  const endDate = searchParams.get("end") || "today";

  try {
    const data = await getAnalyticsData(startDate, endDate);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Analytics API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch analytics data" },
      { status: 500 }
    );
  }
}
