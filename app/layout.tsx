import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CommonGround — Different brands. Shared buying power.",
  description: "Bring small orders together. Find a workable shared order, agree on your terms, and pay your own way.",
  metadataBase: new URL("https://commonground-sejun-2026.pplower.chatgpt.site"),
  openGraph: {
    type: "website",
    title: "CommonGround — Three brands, one shared order",
    description: "Follow three brands from a packaging decision to individual PayPal Sandbox payments.",
    images: [{ url: "/images/commonground-share.jpg", width: 1280, height: 720, alt: "CommonGround with packaging for LUMA, JUNIPER and FORMA" }],
  },
  twitter: { card: "summary_large_image" },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
