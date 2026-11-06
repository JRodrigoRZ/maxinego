import React, { Suspense } from 'react';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { RouterProvider, useRouter } from './context/RouterContext';
import { usePWA } from './hooks/usePWA';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { OfflineIndicator } from './components/OfflineIndicator';





import { UnauthorizedView } from './components/UnauthorizedView';
import { RouteSkeleton } from './components/RouteSkeleton';

// Se descarga cada área únicamente al navegar a ella; evita cargar
// los paneles administrativos en la visita inicial a la tienda pública.
const PortalHome = React.lazy(() => import('./components/PortalHome').then((module) => ({ default: module.PortalHome })));
const LoginView = React.lazy(() => import('./components/LoginView').then((module) => ({ default: module.LoginView })));
const PublicStoreView = React.lazy(() => import('./components/PublicStoreView').then((module) => ({ default: module.PublicStoreView })));
const SuperAdminArea = React.lazy(() => import('./components/SuperAdminArea').then((module) => ({ default: module.SuperAdminArea })));
const StoreAdminArea = React.lazy(() => import('./components/StoreAdminArea').then((module) => ({ default: module.StoreAdminArea })));

function AppContent() {
  const { currentRoute } = useRouter();
  const pwaStatus = usePWA();
  const isPublicStore = currentRoute.type === 'public_store';
  const isStoreAdmin = currentRoute.type === 'store_admin';

  return (
    <div
      className={`min-h-screen ${
        isPublicStore
          ? 'bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 selection:bg-amber-500 selection:text-white'
          : isStoreAdmin
          ? 'bg-slate-50 dark:bg-[#080d1a] text-slate-900 dark:text-slate-100 selection:bg-blue-600 selection:text-white'
          : 'bg-slate-50 dark:bg-[#080d1a] text-slate-900 dark:text-slate-100 selection:bg-amber-500 selection:text-white'
      } flex flex-col transition-colors`}
    >
      {/* Barra de navegación superior responsive - Excluida en tienda pública y en panel administrativo */}
      {!isPublicStore && !isStoreAdmin && (
        <Header pwaStatus={pwaStatus} onInstallClick={pwaStatus.install} />
      )}

      {/* Alerta toast de desconexión PWA */}
      <OfflineIndicator />

      {/* Contenido Dinámico de la Ruta Multi-Tenant */}
      <main className={isPublicStore || isStoreAdmin ? "flex-1 w-full" : "flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-10"}>
        <Suspense fallback={<RouteSkeleton kind={isPublicStore ? 'store' : isStoreAdmin ? 'dashboard' : 'page'} />}>
        {currentRoute.type === 'home' && <PortalHome />}

        {currentRoute.type === 'login' && (
          <LoginView redirectPath={currentRoute.redirect} />
        )}

        {currentRoute.type === 'public_store' && (
          <PublicStoreView slug={currentRoute.slug} />
        )}

        {currentRoute.type === 'superadmin' && <SuperAdminArea />}

        {currentRoute.type === 'store_admin' && (
          <StoreAdminArea tenantId={currentRoute.tenantId} />
        )}

        {currentRoute.type === 'unauthorized' && (
          <UnauthorizedView
            reason={currentRoute.reason}
            attemptedPath={currentRoute.attemptedPath}
            requiredRole={currentRoute.requiredRole}
            userTenantId={currentRoute.userTenantId}
            targetTenantId={currentRoute.targetTenantId}
          />
        )}
        </Suspense>
      </main>

      {/* Pie de página institucional - Excluido en tienda pública y en panel administrativo */}
      {!isPublicStore && !isStoreAdmin && <Footer />}
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <RouterProvider>
          <AppContent />
        </RouterProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
