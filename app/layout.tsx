import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Influence Tracing Research Papers",
  description:
    "Browse and rank research papers on influence tracing, continual learning, federated learning, and federated continual learning."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
