import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { OAuth2Client } from "google-auth-library";

const PROPERTY_ID = process.env.GA4_PROPERTY_ID || "519319453";

function getClient(): BetaAnalyticsDataClient {
  const oauth2Client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
  });
  return new BetaAnalyticsDataClient({ authClient: oauth2Client as never });
}

export interface AnalyticsData {
  visitors: number;
  pageViews: number;
  bokunClicks: number;
  topPages: { page: string; clicks: number; views: number }[];
  dailyVisitors: { date: string; visitors: number; bokunClicks: number }[];
  sources: { source: string; visitors: number; bokunClicks: number }[];
}

export async function getAnalyticsData(
  startDate: string,
  endDate: string
): Promise<AnalyticsData> {
  const client = getClient();
  const property = `properties/${PROPERTY_ID}`;

  // Run reports in parallel
  const [overviewRes, bokunRes, dailyRes, sourcesRes, topPagesRes] =
    await Promise.all([
      // Overview: visitors + pageviews
      client.runReport({
        property,
        dateRanges: [{ startDate, endDate }],
        metrics: [
          { name: "activeUsers" },
          { name: "screenPageViews" },
        ],
      }),
      // Bokun clicks (custom event)
      client.runReport({
        property,
        dateRanges: [{ startDate, endDate }],
        metrics: [{ name: "eventCount" }],
        dimensionFilter: {
          filter: {
            fieldName: "eventName",
            stringFilter: { value: "click_bokun" },
          },
        },
      }),
      // Daily visitors + bokun clicks
      client.runReport({
        property,
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "date" }],
        metrics: [{ name: "activeUsers" }, { name: "eventCount" }],
        orderBys: [{ dimension: { dimensionName: "date" } }],
      }),
      // Traffic sources with bokun clicks
      client.runReport({
        property,
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "sessionSource" }],
        metrics: [{ name: "activeUsers" }, { name: "eventCount" }],
        orderBys: [
          { metric: { metricName: "activeUsers" }, desc: true },
        ],
        limit: 20,
      }),
      // Top pages with bokun clicks
      client.runReport({
        property,
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "pagePath" }],
        metrics: [
          { name: "screenPageViews" },
          { name: "eventCount" },
        ],
        dimensionFilter: {
          filter: {
            fieldName: "eventName",
            stringFilter: { value: "click_bokun" },
          },
        },
        orderBys: [
          { metric: { metricName: "eventCount" }, desc: true },
        ],
        limit: 20,
      }),
    ]);

  const overview = overviewRes[0]?.rows?.[0];
  const bokun = bokunRes[0]?.rows?.[0];

  return {
    visitors: parseInt(overview?.metricValues?.[0]?.value || "0"),
    pageViews: parseInt(overview?.metricValues?.[1]?.value || "0"),
    bokunClicks: parseInt(bokun?.metricValues?.[0]?.value || "0"),
    topPages: (topPagesRes[0]?.rows || []).map((row) => ({
      page: row.dimensionValues?.[0]?.value || "",
      views: parseInt(row.metricValues?.[0]?.value || "0"),
      clicks: parseInt(row.metricValues?.[1]?.value || "0"),
    })),
    dailyVisitors: (dailyRes[0]?.rows || []).map((row) => ({
      date: row.dimensionValues?.[0]?.value || "",
      visitors: parseInt(row.metricValues?.[0]?.value || "0"),
      bokunClicks: parseInt(row.metricValues?.[1]?.value || "0"),
    })),
    sources: (sourcesRes[0]?.rows || []).map((row) => ({
      source: row.dimensionValues?.[0]?.value || "",
      visitors: parseInt(row.metricValues?.[0]?.value || "0"),
      bokunClicks: parseInt(row.metricValues?.[1]?.value || "0"),
    })),
  };
}
