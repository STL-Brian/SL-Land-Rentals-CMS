import { z } from "zod";

export const SECOND_LIFE_GRID = "Second Life" as const;

const terminalProvisionSchema = z.object({
  listingId: z.string().uuid(),
  objectId: z.string().uuid(),
  ownerId: z.string().uuid(),
  shard: z.literal(SECOND_LIFE_GRID),
}).strict();

export type TerminalProvision = z.infer<typeof terminalProvisionSchema>;

export function parseTerminalProvision(value: unknown): TerminalProvision {
  const parsed = terminalProvisionSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid terminal binding");
  return parsed.data;
}
