const ENDPOINT = "https://klarity-ai-research-shield.onrender.com/validate";

export type ValidateResult = {
  result: string;
};

export async function validateTopic(topic: string): Promise<ValidateResult> {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic }),
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error("TIMEOUT: The research service took too long to respond.");
    }
    throw new Error("NETWORK: Could not reach the research service.");
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error("AUTH: The research service rejected the request.");
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`SERVICE: Research service error (${response.status}). ${text.slice(0, 300)}`);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("SERVICE: Received an unreadable response from the research service.");
  }

  const result = payload["result"];
  if (typeof result !== "string" || !result) {
    throw new Error("SERVICE: The research service did not return a result.");
  }
  return { result };
}
