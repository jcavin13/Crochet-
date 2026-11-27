/// <reference types="vite-plugin-pwa/client" />
// Service worker registration (vite-plugin-pwa, autoUpdate). No-op in dev.
//
// "Ready to work offline" is shown only when it is true (review R13): every file of the build —
// including the lazily loaded 3D view chunk, its CSS and the sim worker — is precached
// (onOfflineReady fires after the service worker installed the precache), AND the service worker
// controls this page (on a first visit it takes control via clientsClaim; until then a lazy import
// would still go to the network). The state is mirrored in <html data-offline="ready"> for tests.
import { toast } from '@/ui';

function whenControlled(): Promise<void> {
  const sw = navigator.serviceWorker;
  if (sw.controller) return Promise.resolve();
  return new Promise((resolve) => {
    const on = () => { if (sw.controller) { sw.removeEventListener('controllerchange', on); resolve(); } };
    sw.addEventListener('controllerchange', on);
  });
}

export function registerPwa() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  void import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({
      immediate: true,
      onOfflineReady() {
        void whenControlled().then(() => {
          document.documentElement.dataset.offline = 'ready';
          toast('Ready to work offline');
        });
      },
    });
  });
}
