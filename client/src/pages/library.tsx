import type { RegionView } from '@shared/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmButton, Say } from '@/components/common';
import { SettingsTabs } from '@/components/settings-tabs';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { UploadButton } from '@/components/upload-button';
import { api, imageUrl, useAction, useLibrary, useUser } from '@/lib/api';

export function LibraryPage() {
    const me = useUser();
    const { data } = useLibrary();
    if (!me.isAdmin) return <Say>admins only.</Say>;
    if (!data) return <Say>loading library...</Say>;

    const districts = data.regions.filter((r) => !r.district);
    const inDistrict = (name: string) => data.regions.filter((r) => r.district === name);
    const orphans = data.regions.filter((r) => r.district && !districts.some((d) => d.name === r.district));

    return (
        <div className="space-y-8">
            <div>
                <SettingsTabs />
                <Say>gig pictures. a gig gets one from its region, then its district, then the general pool.</Say>
            </div>

            <Pictures title="General pool" ids={data.pool} region={null} />

            {districts.map((d) => (
                <section key={d.id} className="space-y-3">
                    <h2 className="text-xl text-accent">{d.name}</h2>
                    <Pictures title={`${d.name} (whole district)`} ids={d.images} region={d} />
                    {inDistrict(d.name).map((r) => (
                        <Pictures key={r.id} title={r.name} ids={r.images} region={r} />
                    ))}
                </section>
            ))}
            {orphans.map((r) => (
                <Pictures key={r.id} title={r.name} ids={r.images} region={r} />
            ))}

            <NewRegion districts={districts.map((d) => d.name)} />
        </div>
    );
}

function Pictures({ title, ids, region }: { title: string; ids: number[]; region: RegionView | null }) {
    const remove = useAction((id: number) => api(`/api/library/images/${id}`, 'DELETE'));
    const removeRegion = useAction(() => api(`/api/library/regions/${region!.id}`, 'DELETE'), 'Region deleted.');
    const queryClient = useQueryClient();

    return (
        <Card className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="mb-0 flex-1">
                    {title} <span className="text-muted-foreground">({ids.length})</span>
                </CardTitle>
                <UploadButton
                    multiple
                    options={{ library: true, regionId: region?.id }}
                    onUploaded={async () => {
                        await queryClient.invalidateQueries({ queryKey: ['library'] });
                        toast.success('Uploaded.');
                    }}
                />
                {region && (
                    <ConfirmButton
                        size="icon"
                        label={<Trash2 className="size-4" />}
                        title={`Delete ${region.name}?`}
                        description="Its pictures move to the general pool."
                        onConfirm={() => removeRegion.mutate()}
                    />
                )}
            </div>
            {ids.length > 0 && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                    {ids.map((id) => (
                        <div key={id} className="group relative">
                            <img src={imageUrl(id)} alt="" loading="lazy" className="aspect-video w-full object-cover" />
                            {/* Always shown on touch screens, on hover elsewhere */}
                            <ConfirmButton
                                size="icon"
                                label={<X className="size-3" />}
                                title="Remove this picture?"
                                description="Gigs already using it keep it."
                                onConfirm={() => remove.mutate(id)}
                                className="absolute top-1 right-1 size-6 sm:opacity-0 sm:group-hover:opacity-100"
                            />
                        </div>
                    ))}
                </div>
            )}
        </Card>
    );
}

function NewRegion({ districts }: { districts: string[] }) {
    const [name, setName] = useState('');
    const [district, setDistrict] = useState('');
    const add = useAction(() => api('/api/library/regions', 'POST', { name, district: district || null }), () => setName(''));

    const submit = (e: FormEvent) => {
        e.preventDefault();
        if (name.trim()) add.mutate();
    };

    return (
        <Card>
            <CardTitle>Add a region</CardTitle>
            <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
                <div className="min-w-48 flex-1">
                    <Label htmlFor="region-name">Name</Label>
                    <Input id="region-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
                </div>
                <div className="min-w-48 flex-1">
                    <Label htmlFor="region-district">Part of</Label>
                    <Select
                        id="region-district"
                        value={district}
                        onChange={setDistrict}
                        options={[{ value: '', label: "Nothing (it's a district)" }, ...districts.map((d) => ({ value: d, label: d, hint: 'District' }))]}
                    />
                </div>
                <Button type="submit" disabled={add.isPending || !name.trim()}>
                    <Plus className="size-4" /> Add
                </Button>
            </form>
        </Card>
    );
}
