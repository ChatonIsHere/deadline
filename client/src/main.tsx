import '@/styles/globals.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { Layout } from '@/components/layout';
import { Toaster } from '@/components/ui/sonner';
import { Board } from '@/pages/board';
import { Crew } from '@/pages/crew';
import { Crews } from '@/pages/crews';
import { Gig } from '@/pages/gig';
import { GigEdit } from '@/pages/gig-edit';
import { Login } from '@/pages/login';
import { LibraryPage } from '@/pages/library';
import { MePage } from '@/pages/me';
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
                        <Route path="crews" element={<Crews />} />
                        <Route path="crews/:id" element={<Crew />} />
                        <Route path="library" element={<LibraryPage />} />
                        <Route path="me" element={<MePage />} />
                        <Route path="settings" element={<SettingsPage />} />
                    </Route>
                </Routes>
            </BrowserRouter>
            <Toaster />
        </QueryClientProvider>
    </StrictMode>,
);
