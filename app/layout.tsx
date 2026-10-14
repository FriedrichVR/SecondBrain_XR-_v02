import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WebXR JSON Visualizer — Quest 3",
  description:
    "JSON Crack-style node-graph visualizer in WebXR for Meta Quest 3. Floating spatial cards, curved connectors, immersive expand/collapse.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-void font-mono antialiased">{children}</body>
    </html>
  );
}
