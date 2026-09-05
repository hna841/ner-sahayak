import type { Metadata } from "next";
import { Plus_Jakarta_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Navigation } from "@/components/Navigation";
import { AuthProvider } from "@/components/AuthProvider";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NER Sahayak Control Room",
  description: "Web dashboard for NER Sahayak",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${jakarta.variable} ${plexMono.variable} font-sans antialiased flex min-h-screen bg-void text-body`}
      >
        <AuthProvider>
          <Navigation />
          <main className="flex-1 min-h-screen overflow-auto">
            {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}
