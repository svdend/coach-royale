import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import App from './App.tsx';
import { AuthProvider } from '@/auth/AuthProvider';
import { SubscriptionProvider } from '@/auth/SubscriptionProvider';
import { initSentry } from '@/lib/sentry';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
    mutations: { retry: 0 },
  },
});

if (import.meta.env.VITE_WEB_VITALS === 'true') {
  void import('./lib/webVitals').then(({ reportWebVitals }) => {
    reportWebVitals();
  });
}

// Initialize Sentry early if configured (disabled by default)
void initSentry();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SubscriptionProvider>
          <App />
        </SubscriptionProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
