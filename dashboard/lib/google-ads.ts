import { GoogleAdsApi } from "google-ads-api";

function getClient(): GoogleAdsApi {
  return new GoogleAdsApi({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "",
  });
}

export interface GoogleAdsData {
  totalSpend: number;
  totalClicks: number;
  totalImpressions: number;
  avgCpc: number;
  keywords: {
    keyword: string;
    clicks: number;
    impressions: number;
    cpc: number;
    cost: number;
    conversions: number;
  }[];
  ads: {
    headline: string;
    clicks: number;
    impressions: number;
    cost: number;
    ctr: number;
  }[];
  daily: { date: string; spend: number; clicks: number; impressions: number }[];
  suggestions: string[];
}

export async function getGoogleAdsData(
  startDate: string,
  endDate: string
): Promise<GoogleAdsData> {
  const client = getClient();
  const customerId = (process.env.GOOGLE_ADS_CUSTOMER_ID || "").replace(
    /-/g,
    ""
  );
  const customer = client.Customer({
    customer_id: customerId,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN || "",
  });

  // Campaign performance
  const campaignRows = await customer.query(`
    SELECT
      segments.date,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.average_cpc
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    ORDER BY segments.date ASC
  `);

  // Keyword performance
  const keywordRows = await customer.query(`
    SELECT
      ad_group_criterion.keyword.text,
      metrics.clicks,
      metrics.impressions,
      metrics.average_cpc,
      metrics.cost_micros,
      metrics.conversions
    FROM keyword_view
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    ORDER BY metrics.clicks DESC
    LIMIT 50
  `);

  // Ad performance
  const adRows = await customer.query(`
    SELECT
      ad_group_ad.ad.responsive_search_ad.headlines,
      metrics.clicks,
      metrics.impressions,
      metrics.cost_micros,
      metrics.ctr
    FROM ad_group_ad
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    ORDER BY metrics.clicks DESC
    LIMIT 20
  `);

  // Aggregate campaign daily data
  let totalSpend = 0;
  let totalClicks = 0;
  let totalImpressions = 0;
  const dailyMap = new Map<
    string,
    { spend: number; clicks: number; impressions: number }
  >();

  for (const row of campaignRows) {
    const date = row.segments?.date || "";
    const cost = Number(row.metrics?.cost_micros || 0) / 1_000_000;
    const clicks = Number(row.metrics?.clicks || 0);
    const impressions = Number(row.metrics?.impressions || 0);

    totalSpend += cost;
    totalClicks += clicks;
    totalImpressions += impressions;

    const existing = dailyMap.get(date) || {
      spend: 0,
      clicks: 0,
      impressions: 0,
    };
    existing.spend += cost;
    existing.clicks += clicks;
    existing.impressions += impressions;
    dailyMap.set(date, existing);
  }

  const daily = Array.from(dailyMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Parse keywords
  const keywords = keywordRows.map((row) => ({
    keyword: row.ad_group_criterion?.keyword?.text || "",
    clicks: Number(row.metrics?.clicks || 0),
    impressions: Number(row.metrics?.impressions || 0),
    cpc: Number(row.metrics?.average_cpc || 0) / 1_000_000,
    cost: Number(row.metrics?.cost_micros || 0) / 1_000_000,
    conversions: Number(row.metrics?.conversions || 0),
  }));

  // Parse ads
  const ads = adRows.map((row) => {
    const headlines =
      row.ad_group_ad?.ad?.responsive_search_ad?.headlines || [];
    const headline = Array.isArray(headlines)
      ? headlines.map((h: { text?: string | null }) => h.text || "").join(" | ")
      : "";
    return {
      headline,
      clicks: Number(row.metrics?.clicks || 0),
      impressions: Number(row.metrics?.impressions || 0),
      cost: Number(row.metrics?.cost_micros || 0) / 1_000_000,
      ctr: Number(row.metrics?.ctr || 0) * 100,
    };
  });

  // Generate suggestions
  const suggestions: string[] = [];
  for (const kw of keywords) {
    if (kw.cost > 5 && kw.conversions === 0) {
      suggestions.push(
        `"${kw.keyword}" : £${kw.cost.toFixed(2)} depense, 0 conversion — envisager pause ou ajustement`
      );
    }
    if (kw.clicks > 10 && kw.cpc > totalSpend / totalClicks * 2) {
      suggestions.push(
        `"${kw.keyword}" : CPC (£${kw.cpc.toFixed(2)}) 2x au dessus de la moyenne — verifier la pertinence`
      );
    }
  }

  return {
    totalSpend,
    totalClicks,
    totalImpressions,
    avgCpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
    keywords,
    ads,
    daily,
    suggestions,
  };
}
