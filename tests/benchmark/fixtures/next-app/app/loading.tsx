export default function Loading() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center">
      <div className="flex flex-col items-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
        {/* Typo seeded for bugfix: Lodding */}
        <p className="mt-4">Lodding...</p>
      </div>
    </main>
  );
}
