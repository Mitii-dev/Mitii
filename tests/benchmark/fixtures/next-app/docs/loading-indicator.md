# Loading Indicator

The loading indicator component provides a visual spinner while content loads. It uses Tailwind CSS for styling and animation.

## Implementation

```tsx
export default function Loading() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center">
      <div className="flex flex-col items-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
        <p className="mt-4">Loading...</p>
      </div>
    </main>
  );
}
```

## Usage

This component is automatically rendered by Next.js App Router when navigating to routes that have server-side data fetching in progress. Place this file at `app/loading.tsx` to enable automatic loading states for the entire application or specific route segments.
