import type { GigStatus, Me } from './schemas';

// Used by the server to enforce and by the client to hide buttons.

export const canLogIn = (u: Me) => u.isAdmin || u.isFixer || u.isEdgerunner;

export const canCreateGig = (u: Me) => u.isAdmin || u.isFixer;

/** Fixers can change their own gig until it's approved. Admins can change any. */
export const canEditGig = (u: Me, gig: { createdBy: string; status: GigStatus }) =>
    u.isAdmin || (gig.createdBy === u.id && gig.status === 'pending');

/** Only unposted gigs can be deleted. Posted ones get cancelled instead. */
export const canDeleteGig = (u: Me, gig: { createdBy: string; status: GigStatus }) =>
    (gig.status === 'pending' || gig.status === 'rejected') && (u.isAdmin || gig.createdBy === u.id);

export const canSeeGig = (u: Me, gig: { createdBy: string; status: GigStatus }) =>
    u.isAdmin || gig.createdBy === u.id || (gig.status !== 'pending' && gig.status !== 'rejected');

export const canCreateCrew = (u: Me) => u.isAdmin || u.isEdgerunner;

export const canManageCrew = (u: Me, crew: { ownerId: string }) => u.isAdmin || crew.ownerId === u.id;

/** The gig's own fixer runs it alongside admins: locking sign-ups, completing, cancelling. */
export const canRunGig = (u: Me, gig: { fixerId: string | null }) => u.isAdmin || (!!gig.fixerId && gig.fixerId === u.id);

/** Status changes on a posted gig. Pending gigs are approved or rejected instead. */
export const NEXT_STATUSES: Record<GigStatus, GigStatus[]> = {
    pending: [],
    open: ['closed', 'completed', 'cancelled'],
    closed: ['open', 'completed', 'cancelled'],
    completed: [],
    cancelled: [],
    rejected: [],
};
