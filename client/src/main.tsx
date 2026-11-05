import '@/styles/globals.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Layout } from '@/components/layout';
import { Toaster } from '@/components/ui/sonner';
import { Board } from '@/pages/board';
import { Crew } from '@/pages/crew';
import { Crews } from '@/pages/crews';
import { Gig } from '@/pages/gig';
import { GigComplete } from '@/pages/gig-complete';
import { GigEdit } from '@/pages/gig-edit';
import { Login } from '@/pages/login';
import { LibraryPage } from '@/pages/library';
import { MePage } from '@/pages/me';
import { RunnerPage } from '@/pages/runner';
import { RunnerEdit } from '@/pages/runner-edit';
import { FixersPage, RunnersPage } from '@/pages/runners';
import { SettingsPage } from '@/pages/settings';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000 } } });

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <BrowserRouter>
                <Routes>
                    <Route path="/login" element={<Login />} />
                    <Route element={<Layout />}>
                        <Route index element={<Board />} />
                        <Route path="gigs/new" element={<GigEdit />} />
                        <Route path="gigs/:id" element={<Gig />} />
                        <Route path="gigs/:id/edit" element={<GigEdit />} />
                        <Route path="gigs/:id/complete" element={<GigComplete />} />
                        <Route path="runners" element={<RunnersPage />} />
                        <Route path="runners/new" element={<RunnerEdit />} />
                        <Route path="runners/:id" element={<RunnerPage />} />
                        <Route path="runners/:id/edit" element={<RunnerEdit />} />
                        <Route path="fixers" element={<FixersPage />} />
                        <Route path="crews" element={<Crews />} />
                        <Route path="crews/:id" element={<Crew />} />
                        <Route path="settings/library" element={<LibraryPage />} />
                        <Route path="library" element={<Navigate to="/settings/library" replace />} />
                        <Route path="me" element={<MePage />} />
                        <Route path="settings" element={<SettingsPage />} />
                    </Route>
                </Routes>
            </BrowserRouter>
            <Toaster />
        </QueryClientProvider>
    </StrictMode>,
);
