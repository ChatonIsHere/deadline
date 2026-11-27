import { useQueryClient } from '@tanstack/react-query';
import { BellOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ChatIcon, chatPath, KIND_LABEL } from '@/components/chat';
import { Loading } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { api, useNotifyingChats } from '@/lib/api';
import { disablePush, enablePush, needsHomeScreen, type PushState, pushState } from '@/lib/push';

const STATE_LINE: Record<PushState, string> = {
    on: 'On in this browser.',
    ask: 'Off in this browser.',
    blocked: 'Blocked: allow notifications for this site in your browser settings.',
    off: "Push notifications aren't set up on this server.",
    unsupported: "This browser can't do push notifications.",
};

/**
 * Push notifications for chats: whether this device gets them, and the chats that send them
 * (each chat's bell turns it on). A chat you turn on notifies every device that has push on.
 */
export function ChatNotificationsCard() {
    const queryClient = useQueryClient();
    const { data: chats, isPending } = useNotifyingChats();
    const [state, setState] = useState<PushState | null>(null);
    useEffect(() => {
        void pushState().then(setState);
    }, []);

    const device = async (on: boolean) => {
        try {
            if (on) setState(await enablePush());
            else {
                await disablePush();
                setState('ask');
            }
        } catch (err) {
            toast.error((err as Error).message);
        }
    };
    const off = async (id: string) => {
        try {
            await api(`/api/chats/${id}/notify`, 'PUT', { on: false });
            await queryClient.invalidateQueries({ queryKey: ['chats'] });
        } catch (err) {
            toast.error((err as Error).message);
        }
    };

    return (
        <Card className="space-y-4">
            <CardTitle help="real notifications on this device, even with Deadline closed. pick which chats send them with the bell at the top of a chat.">Chat notifications</CardTitle>
            {state && (
                <div className="flex flex-wrap items-center gap-3">
                    <p className="flex-1 text-sm">
                        {state === 'unsupported' && needsHomeScreen() ? 'On iPhone and iPad, add Deadline to your Home Screen (Share, then Add to Home Screen) and open it from there.' : STATE_LINE[state]}
                    </p>
                    {(state === 'ask' || state === 'on') && (
                        <Button size="sm" variant={state === 'on' ? 'outline' : 'default'} onClick={() => void device(state !== 'on')}>
                            {state === 'on' ? 'Turn off here' : 'Turn on here'}
                        </Button>
                    )}
                </div>
            )}
            {isPending ? (
                <Loading>loading...</Loading>
            ) : chats?.length ? (
                <ul className="space-y-2">
                    {chats.map((c) => (
                        <li key={c.id} className="flex items-center gap-3">
                            <ChatIcon chat={c} className="size-7 [--cut:5px]" />
                            <Link to={chatPath(c.id)} className="min-w-0 flex-1 truncate text-accent hover:underline">
                                {c.title} <span className="text-xs tracking-wider text-muted-foreground uppercase">{KIND_LABEL[c.kind]}</span>
                            </Link>
                            <Button size="sm" variant="ghost" onClick={() => void off(c.id)} aria-label={`Turn off notifications for ${c.title}`}>
                                <BellOff className="size-3.5" /> Off
                            </Button>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-xs text-muted-foreground">no chats send notifications yet. open a chat and press its bell.</p>
            )}
        </Card>
    );
}
