/// <reference types="vite-plugin-pwa/client" />
// Service worker registration (vite-plugin-pwa, autoUpdate). No-op in dev.
import { toast } from '@/ui';

export function registerPwa() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  void import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({
      immediate: true,
      onOfflineReady() {
        toast('Ready to work offline');
      },
    });
  });
}
