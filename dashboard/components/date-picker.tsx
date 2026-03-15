"use client";

import { useRouter, useSearchParams } from "next/navigation";

const PRESETS = [
  { label: "7j", days: 7 },
  { label: "30j", days: 30 },
  { label: "90j", days: 90 },
];

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function DatePicker() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentStart = searchParams.get("start");
  const currentEnd = searchParams.get("end");

  function setRange(days: number) {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    const params = new URLSearchParams(searchParams);
    params.set("start", formatDate(start));
    params.set("end", formatDate(end));
    router.push(`?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-2">
      {PRESETS.map((preset) => (
        <button
          key={preset.days}
          onClick={() => setRange(preset.days)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          {preset.label}
        </button>
      ))}
      <input
        type="date"
        value={currentStart || ""}
        onChange={(e) => {
          const params = new URLSearchParams(searchParams);
          params.set("start", e.target.value);
          if (!currentEnd) params.set("end", formatDate(new Date()));
          router.push(`?${params.toString()}`);
        }}
        className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
      />
      <span className="text-gray-400">—</span>
      <input
        type="date"
        value={currentEnd || ""}
        onChange={(e) => {
          const params = new URLSearchParams(searchParams);
          params.set("end", e.target.value);
          if (!currentStart) {
            const start = new Date();
            start.setDate(start.getDate() - 30);
            params.set("start", formatDate(start));
          }
          router.push(`?${params.toString()}`);
        }}
        className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
      />
    </div>
  );
}
