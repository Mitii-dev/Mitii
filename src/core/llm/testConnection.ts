export interface ProviderConnectionResult {
  ok: boolean;
  message: string;
  models?: string[];
}

export async function testOpenAiCompatibleConnection(
  baseUrl: string,
  model: string,
  apiKey?: string
): Promise<ProviderConnectionResult> {
  const root = baseUrl.replace(/\/$/, '');
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  try {
    const modelsRes = await fetch(`${root}/models`, { headers });
    if (modelsRes.ok) {
      const data = (await modelsRes.json()) as { data?: Array<{ id: string }> };
      const models = data.data?.map((m) => m.id) ?? [];
      const hasModel = models.length === 0 || models.some((m) => m === model || m.startsWith(model));
      if (!hasModel && models.length > 0) {
        return {
          ok: false,
          message: `Connected, but model "${model}" not found. Available: ${models.slice(0, 8).join(', ')}`,
          models,
        };
      }
      return {
        ok: true,
        message: `Connected to ${root}. Model "${model}"${models.length ? ' found' : ' (could not list models)'}.`,
        models,
      };
    }

    // Fallback: tiny completion probe
    const probe = await fetch(`${root}/chat/completions`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 5,
        stream: false,
      }),
    });

    if (probe.ok) {
      return { ok: true, message: `Connected. Model "${model}" responded.` };
    }

    const errText = await probe.text().catch(() => '');
    if (probe.status === 404) {
      return { ok: false, message: `Model "${model}" not found. Is Ollama running? Try: ollama pull ${model}` };
    }
    return { ok: false, message: `Connection failed (${probe.status}): ${errText.slice(0, 150)}` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
      return {
        ok: false,
        message: `Cannot reach ${root}. Start Ollama: \`ollama serve\` or open the Ollama app.`,
      };
    }
    return { ok: false, message: msg };
  }
}
