import { canCreateGig, canEditGig } from '@shared/permissions';
import type { GigDraftInput, GigInput, GigView } from '@shared/schemas';
import { useNavigate, useParams } from 'react-router';
import { Loading, Say } from '@/components/common';
import { GigForm } from '@/components/gig-form';
import { api, useAction, useGig, useUser } from '@/lib/api';

export function GigEdit() {
    const { id } = useParams();
    const me = useUser();
    const navigate = useNavigate();
    const { data: gig, isError } = useGig(id);

    const isDraft = gig?.status === 'draft';
    // A rename changes the link, so go by the saved one
    const open = (saved: GigView) => navigate(`/gigs/${saved.ref}`);
    const save = useAction(
        // The address bar holds the gig's link; saving goes to its numeric ID
        async (input: GigInput) => {
            if (!gig) return api<GigView>('/api/gigs', 'POST', input);
            if (!isDraft) return api<GigView>(`/api/gigs/${gig.id}`, 'PATCH', input);
            await api<GigView>(`/api/gigs/${gig.id}/draft`, 'PATCH', input);
            return api<GigView>(`/api/gigs/${gig.id}/send`, 'POST');
        },
        (saved) => (saved.status === 'pending' ? 'contract submitted. waiting on an admin.' : gig && !isDraft ? 'contract updated.' : 'contract posted.'),
        open,
    );
    const draft = useAction(
        (input: GigDraftInput) => (gig ? api<GigView>(`/api/gigs/${gig.id}/draft`, 'PATCH', input) : api<GigView>('/api/gigs/draft', 'POST', input)),
        'draft saved. nothing posted.',
        open,
    );

    if (isError) return <Say>no such contract.</Say>;
    if (id && !gig) return <Loading>decrypting...</Loading>;
    const allowed = gig ? canEditGig(me, { createdBy: gig.createdBy.id, status: gig.status }) : canCreateGig(me);
    if (!allowed) return <Say>{gig ? "that contract isn't yours to change." : 'only fixers and admins post gigs.'}</Say>;

    return (
        <div className="space-y-5">
            {(!gig || isDraft) && !me.isAdmin && <Say>new gigs wait for an admin to approve them before they hit Discord. save a draft to come back to it.</Say>}
            {/* Keyed so going from one gig (or editing) to a new one starts a fresh form */}
            <GigForm key={gig?.id ?? 'new'} gig={gig} saving={save.isPending || draft.isPending} onSave={(input) => save.mutate(input)} onDraft={(input) => draft.mutate(input)} />
        </div>
    );
}
