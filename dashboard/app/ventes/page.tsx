"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { KpiCard } from "@/components/kpi-card";
import { Chart } from "@/components/chart";
import { Table } from "@/components/table";
import { DatePicker } from "@/components/date-picker";

export default function VentesPage() {
  return (
    <Suspense fallback={<p className="text-gray-500">Chargement...</p>}>
      <VentesContent />
    </Suspense>
  );
}

interface StripeData {
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

function formatGBP(n: number): string {
  return `£${n.toFixed(2)}`;
}

function VentesContent() {
  const searchParams = useSearchParams();
  const [data, setData] = useState<StripeData | null>(null);
  const [loading, setLoading] = useState(true);

  const start =
    searchParams.get("start") ||
    new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const end =
    searchParams.get("end") || new Date().toISOString().slice(0, 10);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/stripe?start=${start}&end=${end}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setData(d);
        setLoading(false);
      });
  }, [start, end]);

  const avgPerSale =
    data && data.totalSales > 0
      ? data.totalRevenue / data.totalSales
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Ventes Stripe</h1>
        <DatePicker />
      </div>

      {loading || !data ? (
        <p className="text-gray-500">Chargement...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <KpiCard label="Revenu total" value={formatGBP(data.totalRevenue)} />
            <KpiCard label="Ventes" value={String(data.totalSales)} />
            <KpiCard label="Panier moyen" value={formatGBP(avgPerSale)} />
          </div>

          <Chart
            data={data.dailyRevenue}
            xKey="date"
            lines={[
              { key: "revenue", color: "#10b981", label: "Revenu (£)" },
              { key: "count", color: "#6366f1", label: "Nb ventes" },
            ]}
          />

          <Table
            title="Ventes recentes"
            columns={[
              {
                key: "date",
                label: "Date",
                render: (v) =>
                  new Date(v as string).toLocaleDateString("fr-FR", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
              },
              {
                key: "amount",
                label: "Montant",
                align: "right",
                render: (v) => formatGBP(v as number),
              },
              {
                key: "description",
                label: "Description",
                render: (v) => (v as string) || "—",
              },
              {
                key: "metadata",
                label: "Source",
                render: (v) => {
                  const meta = v as Record<string, string>;
                  return meta.utm_source || meta.source || "Direct";
                },
              },
            ]}
            data={data.recentSales}
          />
        </>
      )}
    </div>
  );
}
