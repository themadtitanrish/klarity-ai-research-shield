const BASE_URL = "https://klarity-v1-0b02b4f0-13f3-4131-a72f-967225ee-601fcbd6.crewai.com";

export type CrewStatus = {
  state: string;
  raw?: string | undefined;
  error?: string | undefined;
};

function authHeaders() {
  const token = process.env["CREWAI_BEARER_TOKEN"];
  if (!token) throw new Error("CREWAI_BEARER_TOKEN is not configured");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: authHeaders(),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("NETWORK: Could not reach the research service.");
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error("AUTH: The research service rejected the access token.");
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`SERVICE: Research service error (${response.status}). ${text.slice(0, 300)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("SERVICE: Received an unreadable response from the research service.");
  }
}

export async function kickoffCrew(topic: string): Promise<string> {
  const payload = (await request("/kickoff", {
    method: "POST",
    body: JSON.stringify({ inputs: { research_topic: topic } }),
  })) as Record<string, unknown>;

  const id = payload["kickoff_id"] ?? payload["id"] ?? payload["kickoffId"];
  if (typeof id !== "string" || !id) {
    throw new Error("SERVICE: The research service did not return a job id.");
  }
  return id;
}

export async function getCrewStatus(kickoffId: string): Promise<CrewStatus> {
  const payload = (await request(`/status/${encodeURIComponent(kickoffId)}`)) as Record<
    string,
    unknown
  >;

  const state = String(payload["state"] ?? payload["status"] ?? "PENDING").toUpperCase();
  const result = payload["result"] as Record<string, unknown> | string | undefined;

  let raw: string | undefined;
  if (typeof result === "string") raw = result;
  else if (result && typeof result === "object" && typeof result["raw"] === "string") {
    raw = result["raw"] as string;
  } else if (typeof payload["raw"] === "string") {
    raw = payload["raw"] as string;
  }

  const error =
    typeof payload["error"] === "string"
      ? (payload["error"] as string)
      : typeof payload["last_step"] === "string"
        ? undefined
        : undefined;

  return { state, raw, error };
}
