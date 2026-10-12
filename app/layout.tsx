import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pixelware - Complexity under control",
  description:
    "Pixelware — independent software, systems, and experiments. Explore a growing collection of projects built with precision.",
  metadataBase: new URL("https://pixelware.nl"),
  alternates: { canonical: "/" },
  icons: {
    icon: "/favicon.svg?v=pixelware",
    shortcut: "/favicon.svg?v=pixelware",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
