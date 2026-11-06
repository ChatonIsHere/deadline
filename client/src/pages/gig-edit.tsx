import { canCreateGig, canEditGig } from '@shared/permissions';
import type { GigInput, GigView } from '@shared/schemas';
import { useNavigate, useParams } from 'react-router';
import { Say } from '@/components/common';
import { GigForm } from '@/components/gig-form';
import { api, useAction, useGig, useUser } from '@/lib/api';

export function GigEdit() {
    const { id } = useParams();
    const me = useUser();
    const navigate = useNavigate();
    const { data: gig, isError } = useGig(id);

    const save = useAction(
        // The address bar holds the gig's link; saving goes to its numeric ID
        (input: GigInput) => (gig ? api<GigView>(`/api/gigs/${gig.id}`, 'PATCH', input) : api<GigView>('/api/gigs', 'POST', input)),
        (saved) => (id ? 'contract updated.' : saved.status === 'pending' ? 'contract submitted. waiting on an admin.' : 'contract posted.'),
        // A rename changes the link, so go by the saved one
        (saved) => navigate(`/gigs/${saved.ref}`),
    );

    if (isError) return <Say>no such contract.</Say>;
    if (id && !gig) return <Say>decrypting...</Say>;
    const allowed = gig ? canEditGig(me, { createdBy: gig.createdBy.id, status: gig.status }) : canCreateGig(me);
    if (!allowed) return <Say>{gig ? "that contract isn't yours to change." : 'only fixers and admins post gigs.'}</Say>;

    return (
        <div className="space-y-5">
            {!gig && !me.isAdmin && <Say>new gigs wait for an admin to approve them before they hit Discord.</Say>}
            {/* Keyed so going from one gig (or editing) to a new one starts a fresh form */}
            <GigForm key={gig?.id ?? 'new'} gig={gig} saving={save.isPending} onSave={(input) => save.mutate(input)} />
        </div>
    );
}
