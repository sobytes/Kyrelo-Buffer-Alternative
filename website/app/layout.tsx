import type { Metadata } from "next";
import "./globals.css";

const url = "https://kyrelo.com";
const title =
  "Kyrelo — Local scheduler for X, Threads, LinkedIn, Facebook & Instagram";
const description =
  "Schedule and cross-post to X, Threads, LinkedIn, Facebook and Instagram from your own computer. Open-source desktop Buffer alternative for macOS and Windows.";
const ogImage = "/screenshot.png";
const ogImageAlt =
  "Kyrelo desktop app — scheduling and cross-posting across X, Threads, LinkedIn, Facebook and Instagram from macOS";

export const metadata: Metadata = {
  title: { default: title, template: "%s · Kyrelo" },
  description,
  applicationName: "Kyrelo",
  keywords: [
    "Buffer alternative",
    "social media scheduler",
    "cross-posting tool",
    "X scheduler",
    "Twitter scheduler",
    "Threads scheduler",
    "LinkedIn scheduler",
    "Facebook scheduler",
    "Instagram scheduler",
    "open source social media tool",
    "local-first scheduler",
    "desktop social scheduler",
    "Mac social media app",
    "Windows social media app",
    "self-hosted Buffer",
    "kyrelo",
  ],
  metadataBase: new URL(url),
  alternates: { canonical: url },
  openGraph: {
    title,
    description,
    url,
    siteName: "Kyrelo",
    type: "website",
    locale: "en_US",
    images: [
      {
        url: ogImage,
        width: 1592,
        height: 1032,
        alt: ogImageAlt,
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [{ url: ogImage, alt: ogImageAlt }],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },
};

// JSON-LD structured data so Google can show a rich "Software application" card.
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Kyrelo",
  description,
  url,
  image: `${url}${ogImage}`,
  applicationCategory: "BusinessApplication",
  operatingSystem: "macOS, Windows",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  downloadUrl:
    "https://github.com/sobytes/Kyrelo-Buffer-Alternative/releases",
  softwareVersion: "0.1.x",
  publisher: {
    "@type": "Organization",
    name: "SoBytes",
    url,
  },
  license: "https://opensource.org/licenses/MIT",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}
