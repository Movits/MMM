import crypto from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { aiMatchSuggestions, contactAssets, contactNeeds, privateContacts } from "../../drizzle/schema";
import { getDb } from "../db";
import { recalculatePrivateMatches, slugifyMatchTag } from "../match-service";
import { protectedProcedure, router } from "../_core/trpc";

const matchItem = z.object({ contactId: z.number().int().positive(), tagLabel: z.string().trim().min(2).max(200), category: z.string().trim().max(120).optional(), description: z.string().trim().max(2000).optional() });

async function assertOwnedContact(ownerId: string, contactId: number) {
  const db = await getDb();
  if (!db) throw new Error("Banco indisponível.");
  const contact = (await db.select().from(privateContacts).where(and(eq(privateContacts.id, contactId), eq(privateContacts.ownerId, ownerId))).limit(1))[0];
  if (!contact) throw new Error("Contato não encontrado na sua rede privada.");
  return { db, contact };
}

export const intelligentMatchesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Banco indisponível.");
    const [matches, contacts] = await Promise.all([
      db.select().from(aiMatchSuggestions).where(eq(aiMatchSuggestions.ownerId, ctx.user.openId)).orderBy(desc(aiMatchSuggestions.matchScore)),
      db.select().from(privateContacts).where(eq(privateContacts.ownerId, ctx.user.openId)),
    ]);
    const names = new Map(contacts.map(contact => [contact.id, { name: contact.fullName, company: contact.company, jobTitle: contact.jobTitle }]));
    return matches.map(match => ({ ...match, contactA: names.get(match.contactAId), contactB: names.get(match.contactBId) }));
  }),

  contacts: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb(); if (!db) throw new Error("Banco indisponível.");
    return db.select({ id: privateContacts.id, fullName: privateContacts.fullName, company: privateContacts.company }).from(privateContacts).where(eq(privateContacts.ownerId, ctx.user.openId));
  }),

  addAsset: protectedProcedure.input(matchItem).mutation(async ({ ctx, input }) => {
    const { db } = await assertOwnedContact(ctx.user.openId, input.contactId); const timestamp = Date.now();
    await db.insert(contactAssets).values({ ownerId: ctx.user.openId, contactId: input.contactId, tagSlug: slugifyMatchTag(input.tagLabel), tagLabel: input.tagLabel, category: input.category || null, description: input.description || null, createdAt: timestamp, updatedAt: timestamp });
    return recalculatePrivateMatches(ctx.user.openId, ctx.user.email);
  }),

  addNeed: protectedProcedure.input(matchItem).mutation(async ({ ctx, input }) => {
    const { db } = await assertOwnedContact(ctx.user.openId, input.contactId); const timestamp = Date.now();
    await db.insert(contactNeeds).values({ ownerId: ctx.user.openId, contactId: input.contactId, tagSlug: slugifyMatchTag(input.tagLabel), tagLabel: input.tagLabel, category: input.category || null, description: input.description || null, createdAt: timestamp, updatedAt: timestamp });
    return recalculatePrivateMatches(ctx.user.openId, ctx.user.email);
  }),

  recalculate: protectedProcedure.mutation(async ({ ctx }) => recalculatePrivateMatches(ctx.user.openId, ctx.user.email)),

  updateStatus: protectedProcedure.input(z.object({ id: z.string().uuid(), status: z.enum(["viewed", "accepted", "dismissed"]) })).mutation(async ({ ctx, input }) => {
    const db = await getDb(); if (!db) throw new Error("Banco indisponível."); const timestamp = Date.now();
    const patch = input.status === "viewed" ? { status: input.status, viewedAt: timestamp, updatedAt: timestamp } : input.status === "accepted" ? { status: input.status, acceptedAt: timestamp, updatedAt: timestamp } : { status: input.status, dismissedAt: timestamp, updatedAt: timestamp };
    await db.update(aiMatchSuggestions).set(patch).where(and(eq(aiMatchSuggestions.id, input.id), eq(aiMatchSuggestions.ownerId, ctx.user.openId)));
    return { ok: true };
  }),
});
