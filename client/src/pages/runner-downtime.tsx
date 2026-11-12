import { Link, Navigate, useParams } from 'react-router';
import { Loading, Say } from '@/components/common';
import { DowntimePanel } from '@/components/downtime';
import { RunnerAvatar } from '@/components/runner';
import { useRunner } from '@/lib/api';

/** A runner's downtime, on its own page off their profile. Only their player and admins get it. */
export function RunnerDowntimePage() {
    const { id } = useParams();
    const { data: runner, isError } = useRunner(id);

    if (isError) return <Say>no such runner.</Say>;
    if (!runner) return <Loading>pulling records...</Loading>;
    // The server only sends downtime to the runner's player and admins
    if (!runner.downtime) return <Navigate to={`/runners/${runner.slug}`} replace />;

    return (
        <div className="mx-auto w-full max-w-4xl space-y-5">
            <Link to={`/runners/${runner.slug}`} className="group flex w-fit items-center gap-3">
                <RunnerAvatar runner={runner} large className="size-12 text-xl [--cut:6px]" />
                <div>
                    <p className="text-xs tracking-widest text-muted-foreground">// DOWNTIME</p>
                    <h1 className="text-2xl text-primary group-hover:underline">{runner.handle}</h1>
                </div>
            </Link>
            <DowntimePanel runner={runner} />
        </div>
    );
}
