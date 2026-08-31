import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import 'virtual:svg-icons-register';
import '@/i18n';
import '@/theme/light.css';
import '@/theme/dark.css';
import { applyTheme, getStoredThemeMode } from '@/theme';
import '@/styles/index.css';
import '@/store';
import App from '@/App';
import { MessageContainer } from '@/components/base';
import { queryClient } from '@/service/client';

applyTheme(getStoredThemeMode());
// Font catalog is editor-only ? load in EditorPage (not home/plaza cold path).

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <MessageContainer />
    </QueryClientProvider>
  </React.StrictMode>
);
