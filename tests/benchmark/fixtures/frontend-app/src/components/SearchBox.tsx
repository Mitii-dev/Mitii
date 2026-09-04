import { useEffect, useState } from 'react';

interface SearchResult {
  query: string;
  items: string[];
}

async function fakeSearch(query: string): Promise<SearchResult> {
  const delayMs = query.length % 2 === 0 ? 300 : 10;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return { query, items: [`${query}-result-1`, `${query}-result-2`] };
}

export default function SearchBox() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<string[]>([]);

  useEffect(() => {
    if (!query) {
      setResults([]);
      return;
    }
    // BUG: no guard against stale responses — a slower earlier request can
    // resolve after a faster later one and overwrite its results.
    fakeSearch(query).then((result) => {
      setResults(result.items);
    });
  }, [query]);

  return (
    <div>
      <input
        data-testid="search-input"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <ul data-testid="search-results">
        {results.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
