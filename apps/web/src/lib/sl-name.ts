const OFFICIAL_NAME_ENDPOINT = "https://api.secondlife.com/get_agent_id";
const AGENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ParsedSecondLifeUsername {
  username: string;
  lastname: string;
  canonical: string;
}

export function parseSecondLifeUsername(input: string): ParsedSecondLifeUsername {
  const parts = input.trim().replace(".", " ").split(/\s+/).filter(Boolean);
  if (parts.length < 1 || parts.length > 2) throw new Error("invalid Second Life username");
  const username = parts[0]!.toLowerCase();
  const lastname = parts[1]?.toLowerCase() ?? "Resident";
  return { username, lastname, canonical: `${username} ${lastname.toLowerCase()}` };
}

export async function resolveSecondLifeAgentId(
  input: string,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  let parsed: ParsedSecondLifeUsername;
  try {
    parsed = parseSecondLifeUsername(input);
  } catch {
    return null;
  }

  try {
    const response = await fetcher(OFFICIAL_NAME_ENDPOINT, {
      method: "POST",
      headers: { "api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({ username: parsed.username, lastname: parsed.lastname }),
      signal: AbortSignal.timeout(7000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const data = await response.json() as { agent_id?: unknown };
    return typeof data.agent_id === "string" && AGENT_ID.test(data.agent_id) ? data.agent_id : null;
  } catch {
    return null;
  }
}
