"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { KpiCard } from "@/components/kpi-card";
import { Chart } from "@/components/chart";
import { Table } from "@/components/table";
import { DatePicker } from "@/components/date-picker";

export default function DashboardPage() {
  return (
    <Suspense fallback={<p className="text-gray-500">Chargement...</p>}>
      <DashboardContent />
    </Suspense>
  );
}

interface DashboardData {
  analytics: {
    visitors: number;
    pageViews: number;
    bokunClicks: number;
    topPages: { page: string; clicks: number; views: number }[];
    dailyVisitors: { date: string; visitors: number; bokunClicks: number }[];
    sources: { source: string; visitors: number; bokunClicks: number }[];
  } | null;
  ads: {
    totalSpend: number;
    totalClicks: number;
    totalImpressions: number;
    avgCpc: number;
    daily: { date: string; spend: number; clicks: number }[];
  } | null;
  stripe: {
    totalRevenue: number;
    totalSales: number;
    dailyRevenue: { date: string; revenue: number; count: number }[];
  } | null;
}

function formatGBP(n: number): string {
  return `£${n.toFixed(2)}`;
}

function DashboardContent() {
  const searchParams = useSearchParams();
  const [data, setData] = useState<DashboardData>({
    analytics: null,
    ads: null,
    stripe: null,
  });
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  const start = searchParams.get("start") || defaultStart();
  const end = searchParams.get("end") || defaultEnd();

  function defaultStart() {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  }
  function defaultEnd() {
    return new Date().toISOString().slice(0, 10);
  }

  async function login() {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      setAuthed(true);
      setLoginError("");
    } else {
      setLoginError("Mot de passe incorrect");
    }
  }

  useEffect(() => {
    if (!authed) return;
    setLoading(true);

    const params = `?start=${start}&end=${end}`;
    Promise.allSettled([
      fetch(`/api/analytics${params}`).then((r) =>
        r.ok ? r.json() : null
      ),
      fetch(`/api/google-ads${params}`).then((r) =>
        r.ok ? r.json() : null
      ),
      fetch(`/api/stripe${params}`).then((r) =>
        r.ok ? r.json() : null
      ),
    ]).then(([analytics, ads, stripe]) => {
      setData({
        analytics:
          analytics.status === "fulfilled" ? analytics.value : null,
        ads: ads.status === "fulfilled" ? ads.value : null,
        stripe: stripe.status === "fulfilled" ? stripe.value : null,
      });
      setLoading(false);
    });
  }, [authed, start, end]);

  if (!authed) {
    return (
      <div className="mx-auto mt-20 max-w-sm">
        <h1 className="mb-4 text-xl font-bold">Connexion</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && login()}
          placeholder="Mot de passe"
          className="w-full rounded-md border border-gray-300 px-3 py-2"
        />
        {loginError && (
          <p className="mt-2 text-sm text-red-600">{loginError}</p>
        )}
        <button
          onClick={login}
          className="mt-3 w-full rounded-md bg-blue-600 py-2 text-white hover:bg-blue-700"
        >
          Se connecter
        </button>
      </div>
    );
  }

  const revenue = data.stripe?.totalRevenue || 0;
  const spend = data.ads?.totalSpend || 0;
  const roi = spend > 0 ? ((revenue - spend) / spend) * 100 : 0;

  // Merge daily data for chart
  const chartData = (data.analytics?.dailyVisitors || []).map((day) => {
    const adsDay = data.ads?.daily?.find((d) => d.date === day.date);
    const stripeDay = data.stripe?.dailyRevenue?.find(
      (d) => d.date === day.date
    );
    return {
      date: day.date,
      visitors: day.visitors,
      bokunClicks: day.bokunClicks,
      spend: adsDay?.spend || 0,
      revenue: stripeDay?.revenue || 0,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Vue d'ensemble</h1>
        <DatePicker />
      </div>

      {loading ? (
        <p className="text-gray-500">Chargement...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            <KpiCard
              label="Depense Ads"
              value={formatGBP(spend)}
            />
            <KpiCard
              label="Visiteurs"
              value={String(data.analytics?.visitors || 0)}
            />
            <KpiCard
              label="Clics Bokun"
              value={String(data.analytics?.bokunClicks || 0)}
            />
            <KpiCard
              label="Ventes"
              value={String(data.stripe?.totalSales || 0)}
            />
            <KpiCard
              label="Revenu"
              value={formatGBP(revenue)}
            />
            <KpiCard
              label="ROI"
              value={`${roi.toFixed(0)}%`}
              trend={roi > 0 ? "up" : roi < 0 ? "down" : "neutral"}
            />
          </div>

          <Chart
            data={chartData}
            xKey="date"
            lines={[
              { key: "visitors", color: "#6366f1", label: "Visiteurs" },
              { key: "bokunClicks", color: "#f59e0b", label: "Clics Bokun" },
              { key: "spend", color: "#ef4444", label: "Depense (£)" },
              { key: "revenue", color: "#10b981", label: "Revenu (£)" },
            ]}
          />

          <div className="grid gap-6 lg:grid-cols-2">
            <Table
              title="Top pages (clics Bokun)"
              columns={[
                { key: "page", label: "Page" },
                { key: "views", label: "Vues", align: "right" },
                { key: "clicks", label: "Clics Bokun", align: "right" },
              ]}
              data={data.analytics?.topPages || []}
            />

            <Table
              title="Sources de trafic"
              columns={[
                { key: "source", label: "Source" },
                { key: "visitors", label: "Visiteurs", align: "right" },
                { key: "bokunClicks", label: "Clics Bokun", align: "right" },
              ]}
              data={data.analytics?.sources || []}
            />
          </div>
        </>
      )}
    </div>
  );
}
