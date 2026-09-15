import { z } from "zod";

export const SECOND_LIFE_GRID = "Second Life" as const;
const NULL_KEY = "00000000-0000-0000-0000-000000000000";
const secondLifeKey = z.string()
  .trim()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  .transform((value) => value.toLowerCase())
  .refine((value) => value !== NULL_KEY);

const terminalProvisionSchema = z.object({
  listingId: z.string().trim().uuid(),
  objectId: secondLifeKey,
  ownerId: secondLifeKey,
  shard: z.literal(SECOND_LIFE_GRID),
}).strict();

export type TerminalProvision = z.infer<typeof terminalProvisionSchema>;

export function parseTerminalProvision(value: unknown): TerminalProvision {
  const parsed = terminalProvisionSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid terminal binding");
  return parsed.data;
}
