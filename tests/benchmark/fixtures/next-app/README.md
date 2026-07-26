# Next.js Benchmark App

This is a benchmark application built with Next.js App Router.

## Loading Component Verification

The application includes a loading indicator component that displays during page transitions and data fetching.

### How to Verify Loading Component in Development

1. **Start the development server**:
   ```bash
   npm run dev
   ```

2. **Navigate to the home route**:
   - Open your browser and go to `http://localhost:3000`
   - The loading spinner should appear during initial page load

3. **Test page transitions**:
   - Click on any links within the application
   - Observe the loading spinner during route changes
   - The component will be automatically used by Next.js during route changes and data fetching

4. **Verify the visual appearance**:
   - The loading indicator should be centered both vertically and horizontally
   - A spinning animation should be visible with "Loading..." text
   - The component uses Tailwind CSS classes for styling:
     - `animate-spin` for the spinning animation
     - `rounded-full` for circular shape
     - `h-12` and `w-12` for size
     - `border-t-2` and `border-b-2` for border styling
     - `border-blue-500` for color

### Implementation Details

The loading component is located at `app/loading.tsx` and follows Next.js App Router conventions. It provides a centered loading indicator with visual feedback during page transitions and data fetching operations.

### Testing Requirements

To run the lint verification:
```bash
npm run lint
```

To start the development server:
```bash
npm run dev
```

### Verification Steps

1. Run `npm install` to install dependencies
2. Run `npm run dev` to start the development server
3. Visit `http://localhost:3000` in your browser
4. You should see the loading spinner with "Loading..." text centered on the page
5. The spinner should be animating smoothly
6. Run `npm run lint` to verify code quality