import { systemRouter } from "./_core/systemRouter";
import { router } from "./_core/trpc";
import { authRouter } from "./routers/auth";
import { profileRouter } from "./routers/profile";
import { opportunitiesRouter } from "./routers/opportunities";
import { notificationsRouter } from "./routers/notifications";
import { vaultRouter } from "./routers/vault";
import { adminRouter } from "./routers/admin";
import { profileMatchesRouter } from "./routers/profileMatches";
import { connectionsRouter } from "./routers/connections";
import { presidentRouter } from "./routers/president";
import { matchingRouter } from "./routers/matching";
import { faqRouter } from "./routers/faq";
import { statsRouter } from "./routers/stats";
import { networkRouter } from "./routers/network";
import { contextsRouter } from "./routers/contexts";
import { enrichmentRouter } from "./routers/enrichment";
import { dealRoomRouter } from "./routers/dealRoom";
import { sivcRouter } from "./routers/sivc";
import { meetingsRouter } from "./routers/meetings";
import { memoryRouter } from "./routers/memory";
import { intelligentMatchesRouter } from "./routers/matches";

// ============================================================
// ROUTER PRINCIPAL — cada área vive em server/routers/<área>.ts
// ============================================================
export const appRouter = router({
  system: systemRouter,
  dealRoom: dealRoomRouter,
  sivc: sivcRouter,
  auth: authRouter,
  profile: profileRouter,
  opportunities: opportunitiesRouter,
  notifications: notificationsRouter,
  vault: vaultRouter,
  admin: adminRouter,
  matches: profileMatchesRouter,
  connections: connectionsRouter,
  president: presidentRouter,
  matching: matchingRouter,
  faq: faqRouter,
  stats: statsRouter,
  network: networkRouter,
  contexts: contextsRouter,
  enrichment: enrichmentRouter,
  meetings: meetingsRouter,
  memory: memoryRouter,
  intelligentMatches: intelligentMatchesRouter,
});

export type AppRouter = typeof appRouter;
