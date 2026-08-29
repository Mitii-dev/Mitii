export const metadata = {
  title: 'Benchmark Next App',
  // Typo seeded for bugfix: benchmak
  description: 'Mitii benchmak fixture',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
