import { NextRequest, NextResponse } from "next/server";
import { getGoogleAdsData } from "@/lib/google-ads";
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

  if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
    return NextResponse.json(
      { error: "Google Ads API non configure (developer token manquant)" },
      { status: 501 }
    );
  }

  try {
    const data = await getGoogleAdsData(startDate, endDate);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Google Ads API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch Google Ads data" },
      { status: 500 }
    );
  }
}
