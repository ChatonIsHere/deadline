import { type GigStatus, isLive, type Me } from './schemas';

/** Not on the board for players: still being written, waiting for sign-off, or turned down. */
export const isUnposted = (status: GigStatus) => status === 'draft' || status === 'pending' || status === 'rejected';
/** Still being worked on before anyone approves it. */
const isUnapproved = (status: GigStatus) => status === 'draft' || status === 'pending';

// Used by the server to enforce and by the client to hide buttons.
// Once approved, a gig is a session and only admins (the GMs) run it: status, time, slots, runners.

/** The owner can always get in, so player view can't lock them out. */
export const canLogIn = (u: Me) => u.isOwner || u.isAdmin || u.isFixer || u.isEdgerunner;

export const canCreateGig = (u: Me) => u.isAdmin || u.isFixer;

/**
 * Fixers can change their own gig until it's approved. Admins can change any gig that
 * isn't finished (finished gigs have already paid out).
 */
export const canEditGig = (u: Me, gig: { createdBy: string; status: GigStatus }) =>
    (u.isAdmin && (isUnapproved(gig.status) || isLive(gig.status))) || (gig.createdBy === u.id && isUnapproved(gig.status));

/** Only unposted gigs can be deleted. Posted ones get cancelled instead. */
export const canDeleteGig = (u: Me, gig: { createdBy: string; status: GigStatus }) =>
    isUnposted(gig.status) && (u.isAdmin || gig.createdBy === u.id);

export const canSeeGig = (u: Me, gig: { createdBy: string; status: GigStatus }) =>
    u.isAdmin || gig.createdBy === u.id || !isUnposted(gig.status);

export const canCreateCrew = (u: Me) => u.isAdmin || u.isEdgerunner;

/** A crew's first rank is its founder rank. Founders run the crew. */
export const isFounderRank = (crew: { ranks: string[] }, rank: string) => rank === crew.ranks[0];

/** Admins, and players with a runner holding the founder rank. */
export const canManageCrew = (u: Me, crew: { ranks: string[]; members: { rank: string; ownerId: string | null }[] }) =>
    u.isAdmin || crew.members.some((m) => m.ownerId === u.id && isFounderRank(crew, m.rank));

/** Status changes an admin can make on a posted gig. Drafts get sent, pending gigs approved or rejected. */
export const NEXT_STATUSES: Record<GigStatus, GigStatus[]> = {
    draft: [],
    pending: [],
    open: ['closed', 'completed', 'cancelled'],
    closed: ['open', 'completed', 'cancelled'],
    completed: [],
    cancelled: [],
    rejected: [],
};
