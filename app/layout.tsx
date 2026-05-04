import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Watchfox',
  description:
    'Watchfox — multi-tab JSON / JS / TS workspace with watch paths, find, bookmarks, and compare.',
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
