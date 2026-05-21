import type { Metadata } from "next";
import "./globals.css";

const url = "https://kyrelo.com";
const title = "Kyrelo — Local Buffer alternative for X";
const description =
  "Schedule X posts, watch handles, and reply with AI from your own computer. Open-source Buffer alternative for macOS and Windows.";
const ogImage = "/screenshot.png";
const ogImageAlt =
  "Kyrelo desktop app — watching 24 X handles with AI reply prompts";

export const metadata: Metadata = {
  title: { default: title, template: "%s · Kyrelo" },
  description,
  applicationName: "Kyrelo",
  keywords: [
    "Buffer alternative",
    "X scheduler",
    "Twitter scheduler",
    "open source social media tool",
    "local-first scheduler",
    "desktop social scheduler",
    "Mac Twitter app",
    "Windows Twitter app",
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
