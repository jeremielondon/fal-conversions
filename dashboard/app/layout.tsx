import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FAL Conversions — Dashboard",
  description: "Suivi des conversions Google Ads / Bokun",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body className="bg-gray-50 text-gray-900 antialiased">
        <nav className="border-b border-gray-200 bg-white">
          <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
            <a href="/" className="text-lg font-bold text-blue-600">
              FAL Conversions
            </a>
            <a
              href="/"
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Vue d'ensemble
            </a>
            <a
              href="/campagne"
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Campagne Ads
            </a>
            <a
              href="/ventes"
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Ventes
            </a>
          </div>
        </nav>
        <main className="mx-auto max-w-7xl px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
