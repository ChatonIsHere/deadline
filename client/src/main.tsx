import '@/styles/globals.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, createRoutesFromElements, Navigate, Route } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { Layout } from '@/components/layout';
import { Toaster } from '@/components/ui/sonner';
import { loadConfig } from '@/lib/api';
import { UnsavedChangesGuard } from '@/lib/unsaved';
import { Board } from '@/pages/board';
import { Crew } from '@/pages/crew';
import { Crews, NewCrewPage } from '@/pages/crews';
import { Gig } from '@/pages/gig';
import { GigComplete } from '@/pages/gig-complete';
import { FixerEdit } from '@/pages/fixer-edit';
import { GigEdit } from '@/pages/gig-edit';
import { Login } from '@/pages/login';
import { LibraryPage } from '@/pages/library';
import { FixerPage } from '@/pages/fixer';
import { MePage } from '@/pages/me';
import { AvailabilityPage } from '@/pages/availability';
import { SetupPage } from '@/pages/setup';
import { RunnerPage } from '@/pages/runner';
import { RunnerEdit } from '@/pages/runner-edit';
import { FixersPage, RunnersPage } from '@/pages/runners';
import { SettingsPage } from '@/pages/settings';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000 } } });

// A data router, so a page with unsaved changes can ask before you leave it (lib/unsaved.tsx)
const router = createBrowserRouter(
    createRoutesFromElements(
        <Route element={<UnsavedChangesGuard />}>
            <Route path="/login" element={<Login />} />
            <Route element={<Layout />}>
                {/* Signed in, the root is the gig list */}
                <Route index element={<Navigate to="/gigs" replace />} />
                <Route path="gigs" element={<Board />} />
                <Route path="gigs/new" element={<GigEdit />} />
                <Route path="gigs/:id" element={<Gig />} />
                <Route path="gigs/:id/edit" element={<GigEdit />} />
                <Route path="gigs/:id/complete" element={<GigComplete />} />
                <Route path="runners" element={<RunnersPage />} />
                <Route path="runners/new" element={<RunnerEdit />} />
                <Route path="runners/:id" element={<RunnerPage />} />
                <Route path="runners/:id/edit" element={<RunnerEdit />} />
                <Route path="fixers" element={<FixersPage />} />
                <Route path="fixers/new" element={<FixerEdit />} />
                <Route path="fixers/:id" element={<FixerPage />} />
                <Route path="fixers/:id/edit" element={<FixerEdit />} />
                <Route path="crews" element={<Crews />} />
                <Route path="crews/new" element={<NewCrewPage />} />
                <Route path="crews/:id" element={<Crew />} />
                <Route path="settings/library" element={<LibraryPage />} />
                {/* Old /library links */}
                <Route path="library" element={<Navigate to="/settings/library" replace />} />
                <Route path="me" element={<MePage />} />
                <Route path="setup" element={<SetupPage />} />
                <Route path="availability" element={<AvailabilityPage />} />
                <Route path="settings" element={<SettingsPage />} />
                {/* Used to be tabs of their own */}
                <Route path="settings/scheduling" element={<Navigate to="/settings" replace />} />
                <Route path="settings/roles" element={<Navigate to="/settings" replace />} />
                <Route path="settings/bot" element={<Navigate to="/settings" replace />} />
            </Route>
        </Route>,
    ),
);

// Where pictures live comes first: every picture link is built from it
void loadConfig().then(() =>
    createRoot(document.getElementById('root')!).render(
        <StrictMode>
            <QueryClientProvider client={queryClient}>
                <RouterProvider router={router} />
                <Toaster />
            </QueryClientProvider>
        </StrictMode>,
    ),
);
