import type { GigInput, GigView } from '@shared/schemas';
import { useNavigate, useParams } from 'react-router';
import { Say } from '@/components/common';
import { GigForm } from '@/components/gig-form';
import { api, useAction, useGig, useUser } from '@/lib/api';

export function GigEdit() {
    const { id } = useParams();
    const me = useUser();
    const navigate = useNavigate();
    const { data: gig } = useGig(id);

    const save = useAction(
        (input: GigInput) => (id ? api<GigView>(`/api/gigs/${id}`, 'PATCH', input) : api<GigView>('/api/gigs', 'POST', input)),
        (saved) => navigate(`/gigs/${saved.id}`),
    );

    if (id && !gig) return <Say>decrypting...</Say>;

    return (
        <div className="space-y-5">
            <h1 className="text-3xl text-primary">{gig ? 'Edit gig' : 'New gig'}</h1>
            {!gig && !me.isAdmin && <Say>new gigs wait for an admin to approve them before they hit Discord.</Say>}
            <GigForm gig={gig} saving={save.isPending} onSave={(input) => save.mutate(input)} />
        </div>
    );
}
