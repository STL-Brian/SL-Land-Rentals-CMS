import { z } from "zod";

export const rentalKindSchema = z.enum(["PARCEL", "FULL_REGION"]);
export type RentalKind = z.infer<typeof rentalKindSchema>;
export const roleSchema = z.enum(["ADMINISTRATOR", "MANAGER", "AGENT", "RENTER", "RESIDENT"]);
export type Role = z.infer<typeof roleSchema>;
export const roleMutationSchema = z.object({
  role: roleSchema,
  reason: z.string().trim().min(5).max(500),
});
export const reservationCreateSchema = z.object({
  listingId: z.string().uuid(),
  targetUserId: z.string().uuid(),
  expiresAt: z.string().datetime({ offset: true }),
  idempotencyKey: z.string().trim().min(8).max(100).regex(/^[A-Za-z0-9._:-]+$/),
  notes: z.string().trim().max(1000).default(""),
});
export const reservationCancelSchema = z.object({
  reason: z.string().trim().min(3).max(1000),
});
export const checkoutRequestSchema=z.object({listingId:z.string().uuid().optional(),rentalId:z.string().uuid().optional()})
  .refine(value=>(value.listingId?1:0)+(value.rentalId?1:0)===1,"Exactly one checkout target is required");

export const challengeRequestSchema = z.object({
  username: z.string().trim().min(3).max(63).regex(/^[a-zA-Z0-9._ -]+$/).transform((v) => v.toLowerCase())
});
export const challengeVerifySchema = z.object({ username: z.string().trim().min(3).max(63), code: z.string().regex(/^\d{8}$/) });
export const passwordSchema = z.string().min(12).max(1024);
export const passwordLoginSchema = z.object({ username: challengeRequestSchema.shape.username, password: passwordSchema });
export const passwordSetupSchema = z.object({ grant: z.string().min(40).max(200), password: passwordSchema, confirmation: z.string() })
  .refine(value => value.password === value.confirmation, { path: ["confirmation"], message: "Passwords must match" });
export const passwordChangeSchema = z.object({ currentPassword: passwordSchema, password: passwordSchema, confirmation: z.string() })
  .refine(value => value.password === value.confirmation, { path: ["confirmation"], message: "Passwords must match" });
export const terminalPaymentSchema = z.object({
  amountLinden: z.number().int().positive().max(2_147_483_647),
  payerAvatarId: z.string().uuid(),
  payerName: z.string().min(1).max(128).optional()
});
export const terminalPollSchema = z.object({ sequence: z.coerce.number().int().nonnegative().default(0) });
const actionReasonSchema = z.string().trim().min(3).max(1000);
export const rentalAdminSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("EXTEND"), weeks: z.number().int().min(1).max(52) }),
  z.object({ action: z.literal("END"), reason: actionReasonSchema }),
]);
export const terminalActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ROTATE"), reason: actionReasonSchema }),
  z.object({ action: z.literal("REVOKE"), reason: actionReasonSchema }),
  z.object({ action: z.literal("REBIND"), listingId: z.string().uuid(), reason: actionReasonSchema }),
]);

const listingFields = {
  name: z.string().trim().min(3).max(100), slug: z.string().regex(/^[a-z0-9-]+$/), kind: rentalKindSchema,
  description: z.string().trim().min(20).max(4000), regionName: z.string().trim().min(2).max(100),
  areaSqm: z.number().int().positive(), prims: z.number().int().nonnegative(), weeklyLinden: z.number().int().positive(),
  setupLinden: z.number().int().nonnegative(), stripeWeekly: z.string().regex(/^(0|[1-9]\d*)\.\d{2}$/),
  stripeSetup: z.string().regex(/^(0|[1-9]\d*)\.\d{2}$/), published: z.boolean()
};
export const listingMutationSchema = z.object(listingFields).extend({
  setupLinden: listingFields.setupLinden.default(0),stripeSetup:listingFields.stripeSetup.default("0.00"),published:listingFields.published.default(false)
});
export const listingPatchSchema = z.object({ ...listingFields, reason: actionReasonSchema.optional() }).partial()
  .refine(value=>Object.keys(value).length>0)
  .superRefine((value,ctx)=>{if(value.published===false&&!value.reason)ctx.addIssue({code:"custom",path:["reason"],message:"Reason is required when unpublishing"});});
