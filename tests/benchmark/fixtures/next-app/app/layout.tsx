export const metadata = {
  title: 'Benchmark Next App',
  description: 'Mitii benchmark fixture',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
