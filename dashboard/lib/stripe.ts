import Stripe from "stripe";

function getClient(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY || "", {
    apiVersion: "2025-02-24.acacia",
  });
}

export interface StripeData {
  totalRevenue: number;
  totalSales: number;
  recentSales: {
    id: string;
    amount: number;
    currency: string;
    description: string | null;
    date: string;
    metadata: Record<string, string>;
  }[];
  dailyRevenue: { date: string; revenue: number; count: number }[];
}

export async function getStripeData(
  startDate: string,
  endDate: string
): Promise<StripeData> {
  const stripe = getClient();
  const start = Math.floor(new Date(startDate).getTime() / 1000);
  const end = Math.floor(new Date(endDate + "T23:59:59Z").getTime() / 1000);

  // Fetch charges in the date range
  const charges: Stripe.Charge[] = [];
  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore) {
    const params: Stripe.ChargeListParams = {
      created: { gte: start, lte: end },
      limit: 100,
    };
    if (startingAfter) params.starting_after = startingAfter;

    const batch = await stripe.charges.list(params);
    charges.push(
      ...batch.data.filter(
        (c) => c.status === "succeeded" && !c.refunded
      )
    );
    hasMore = batch.has_more;
    if (batch.data.length > 0) {
      startingAfter = batch.data[batch.data.length - 1].id;
    }
  }

  // Aggregate daily
  const dailyMap = new Map<string, { revenue: number; count: number }>();
  for (const charge of charges) {
    const date = new Date(charge.created * 1000)
      .toISOString()
      .slice(0, 10);
    const existing = dailyMap.get(date) || { revenue: 0, count: 0 };
    existing.revenue += charge.amount / 100;
    existing.count += 1;
    dailyMap.set(date, existing);
  }

  const dailyRevenue = Array.from(dailyMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    totalRevenue: charges.reduce((sum, c) => sum + c.amount / 100, 0),
    totalSales: charges.length,
    recentSales: charges.slice(0, 50).map((c) => ({
      id: c.id,
      amount: c.amount / 100,
      currency: c.currency,
      description: c.description,
      date: new Date(c.created * 1000).toISOString(),
      metadata: (c.metadata as Record<string, string>) || {},
    })),
    dailyRevenue,
  };
}
