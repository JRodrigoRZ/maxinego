import React from 'react';

interface RouteSkeletonProps {
  kind?: 'store' | 'dashboard' | 'page';
}

/** Marcadores de contenido accesibles durante la descarga de la ruta y sus datos. */
export const RouteSkeleton: React.FC<RouteSkeletonProps> = ({ kind = 'page' }) => {
  const isStore = kind === 'store';
  return (
    <div role="status" aria-busy="true" aria-label="Cargando contenido" className="w-full max-w-7xl mx-auto px-4 py-6 sm:px-6 space-y-6">
      <span className="sr-only">Cargando contenido…</span>
      <div aria-hidden="true" className="animate-pulse motion-reduce:animate-none space-y-6">
        <div className="flex justify-between items-center gap-4">
          <div className="w-40 h-9 rounded-xl bg-slate-200 dark:bg-slate-800" />
          <div className="w-16 h-9 rounded-xl bg-slate-200 dark:bg-slate-800" />
        </div>
        <div className={`rounded-2xl bg-slate-200 dark:bg-slate-800 ${isStore ? 'h-48 sm:h-72' : 'h-28 sm:h-44'}`} />
        <div className="flex gap-3">
          <div className="w-44 h-10 rounded-xl bg-slate-200 dark:bg-slate-800" />
          <div className="w-24 h-10 rounded-xl bg-slate-200 dark:bg-slate-800" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: kind === 'dashboard' ? 3 : 6 }, (_, index) => (
            <div key={index} className="rounded-2xl overflow-hidden border border-slate-100 dark:border-slate-800">
              <div className="aspect-[4/3] bg-slate-200 dark:bg-slate-800" />
              <div className="p-4 space-y-3">
                <div className="h-4 w-3/4 rounded bg-slate-200 dark:bg-slate-800" />
                <div className="h-3 w-1/2 rounded bg-slate-200 dark:bg-slate-800" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
