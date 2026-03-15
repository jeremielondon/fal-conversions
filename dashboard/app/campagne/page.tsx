"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { KpiCard } from "@/components/kpi-card";
import { Chart } from "@/components/chart";
import { Table } from "@/components/table";
import { DatePicker } from "@/components/date-picker";

export default function CampagnePage() {
  return (
    <Suspense fallback={<p className="text-gray-500">Chargement...</p>}>
      <CampagneContent />
    </Suspense>
  );
}

interface AdsData {
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

function formatGBP(n: number): string {
  return `£${n.toFixed(2)}`;
}

function CampagneContent() {
  const searchParams = useSearchParams();
  const [data, setData] = useState<AdsData | null>(null);
  const [loading, setLoading] = useState(true);

  const start =
    searchParams.get("start") ||
    new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const end =
    searchParams.get("end") || new Date().toISOString().slice(0, 10);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/google-ads?start=${start}&end=${end}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setData(d);
        setLoading(false);
      });
  }, [start, end]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Campagne Google Ads</h1>
        <DatePicker />
      </div>

      {loading || !data ? (
        <p className="text-gray-500">Chargement...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <KpiCard label="Depense totale" value={formatGBP(data.totalSpend)} />
            <KpiCard label="Clics" value={String(data.totalClicks)} />
            <KpiCard
              label="Impressions"
              value={data.totalImpressions.toLocaleString()}
            />
            <KpiCard label="CPC moyen" value={formatGBP(data.avgCpc)} />
          </div>

          <Chart
            data={data.daily}
            xKey="date"
            lines={[
              { key: "spend", color: "#ef4444", label: "Depense (£)" },
              { key: "clicks", color: "#6366f1", label: "Clics" },
            ]}
          />

          {data.suggestions.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
              <h3 className="font-semibold text-amber-800">
                Suggestions d'amelioration
              </h3>
              <ul className="mt-2 list-disc pl-5 text-sm text-amber-700">
                {data.suggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}

          <Table
            title="Performance par mot-cle"
            columns={[
              { key: "keyword", label: "Mot-cle" },
              { key: "clicks", label: "Clics", align: "right" },
              { key: "impressions", label: "Impressions", align: "right" },
              {
                key: "cpc",
                label: "CPC",
                align: "right",
                render: (v) => formatGBP(v as number),
              },
              {
                key: "cost",
                label: "Cout",
                align: "right",
                render: (v) => formatGBP(v as number),
              },
              { key: "conversions", label: "Conv.", align: "right" },
            ]}
            data={data.keywords}
          />

          <Table
            title="Performance par annonce"
            columns={[
              { key: "headline", label: "Titre" },
              { key: "clicks", label: "Clics", align: "right" },
              { key: "impressions", label: "Impressions", align: "right" },
              {
                key: "cost",
                label: "Cout",
                align: "right",
                render: (v) => formatGBP(v as number),
              },
              {
                key: "ctr",
                label: "CTR",
                align: "right",
                render: (v) => `${(v as number).toFixed(2)}%`,
              },
            ]}
            data={data.ads}
          />
        </>
      )}
    </div>
  );
}
