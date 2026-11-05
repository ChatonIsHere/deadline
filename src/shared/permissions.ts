import { type GigStatus, isLive, type Me } from './schemas';

// Used by the server to enforce and by the client to hide buttons.
// Once approved, a gig is a session and only admins (the GMs) run it: status, time, slots, runners.

export const canLogIn = (u: Me) => u.isAdmin || u.isFixer || u.isEdgerunner;

export const canCreateGig = (u: Me) => u.isAdmin || u.isFixer;

/**
 * Fixers can change their own gig until it's approved. Admins can change any gig that
 * isn't finished (finished gigs have already paid out).
 */
export const canEditGig = (u: Me, gig: { createdBy: string; status: GigStatus }) =>
    (u.isAdmin && (gig.status === 'pending' || isLive(gig.status))) || (gig.createdBy === u.id && gig.status === 'pending');

/** Only unposted gigs can be deleted. Posted ones get cancelled instead. */
export const canDeleteGig = (u: Me, gig: { createdBy: string; status: GigStatus }) =>
    (gig.status === 'pending' || gig.status === 'rejected') && (u.isAdmin || gig.createdBy === u.id);

export const canSeeGig = (u: Me, gig: { createdBy: string; status: GigStatus }) =>
    u.isAdmin || gig.createdBy === u.id || (gig.status !== 'pending' && gig.status !== 'rejected');

export const canCreateCrew = (u: Me) => u.isAdmin || u.isEdgerunner;

/** A crew's first rank is its founder rank. Founders run the crew. */
export const isFounderRank = (crew: { ranks: string[] }, rank: string) => rank === crew.ranks[0];

/** Admins, and players with a runner holding the founder rank. */
export const canManageCrew = (u: Me, crew: { ranks: string[]; members: { rank: string; ownerId: string | null }[] }) =>
    u.isAdmin || crew.members.some((m) => m.ownerId === u.id && isFounderRank(crew, m.rank));

/** Status changes an admin can make on a posted gig. Pending gigs are approved or rejected instead. */
export const NEXT_STATUSES: Record<GigStatus, GigStatus[]> = {
    pending: [],
    open: ['closed', 'completed', 'cancelled'],
    closed: ['open', 'completed', 'cancelled'],
    completed: [],
    cancelled: [],
    rejected: [],
};
