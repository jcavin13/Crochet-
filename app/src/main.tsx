import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/ui/theme.css';
import '@/ui/components.css';
import '@/app/shell.css';
import { App } from '@/app/App';
import { registerPwa } from '@/app/pwa';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerPwa();
