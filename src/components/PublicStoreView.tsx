import React, { useEffect, useState } from 'react';
import {
  Store as StoreIcon,
  ShoppingBag,
  ArrowLeft,
  History,
  Check,
  MessageCircle,
} from 'lucide-react';
import {
  Store,
  StoreProfileSettings,
  StoreAppearanceSettings,
  StoreScheduleDay,
  StoreShippingSettings,
  StoreScheduledOrdersSettings,
  StorePaymentSettings,
  Product,
  Category,
  ProfessionalItem,
  FashionSettings,
  GeneralSettings,
  RestaurantSettings,
  PromotionCode,
} from '../types';
import { resolveStoreBySlug } from '../lib/multiTenantService';
import {
  getStoreProfile,
  fetchStoreProfile,
  getStoreAppearance,
  getCachedStoreAppearance,
  getStoreSchedule,
  getCachedStoreSchedule,
  fetchStoreSchedule,
  getCachedStoreShipping,
  fetchStoreShipping,
  getStoreShipping,
  getCachedStoreScheduledOrders,
  fetchStoreScheduledOrders,
  getStoreScheduledOrders,
  getCachedStorePaymentSettings,
  fetchStorePaymentSettings,
  getStorePaymentSettings,
  getCachedStoreProducts,
  fetchStoreProducts,
  getStoreProducts,
  getStoreCategories,
  getCachedStoreCategories,
  fetchStoreCategories,
  getStoreProfessionals,
  fetchStoreProfessionals,
  getFashionSettings,
  fetchFashionSettings,
  getGeneralSettings,
  fetchGeneralSettings,
  getRestaurantSettings,
  fetchRestaurantSettings,
  fetchPublicActivePromotions,
  getCachedStorePromotions,
  isStorePaidPlan,
  isStoreProPlan,
} from '../lib/storeAdminService';
import { useRouter } from '../context/RouterContext';
import { useAuth } from '../context/AuthContext';
import { useStorePWA } from '../lib/pwaTenantService';

// Subcomponentes del Módulo 5
import { PublicStoreHeader } from './publicStore/PublicStoreHeader';
import { StoreBannersCarousel } from './publicStore/StoreBannersCarousel';
import { StoreStoriesBar } from './publicStore/StoreStoriesBar';
import { StoreStoryViewerModal } from './publicStore/StoreStoryViewerModal';
import { StoreLocationMap } from './publicStore/StoreLocationMap';
import { CatalogView } from './publicStore/CatalogView';
import { ProductDetailModal } from './publicStore/ProductDetailModal';
import { CartDrawer } from './publicStore/CartDrawer';
import { CheckoutModal } from './publicStore/CheckoutModal';
import { ServiceBookingModal } from './publicStore/ServiceBookingModal';
import { FashionSizeGuideModal } from './publicStore/FashionSizeGuideModal';
import { CustomerOrdersModal } from './publicStore/CustomerOrdersModal';
import {
  getTenantCart,
  saveTenantCart,
  clearTenantCart,
  getCustomerPlacedOrders,
  getCustomerAppointments,
} from './publicStore/cartStorage';
import { CartItem } from './publicStore/types';
import { ThemeToggle } from './ThemeToggle';
import { RouteSkeleton } from './RouteSkeleton';
import { PriceDisplay } from './common/PriceDisplay';
import { StorePWAInstallButton } from './publicStore/StorePWAInstallButton';
import { StoreHighlights } from './publicStore/StoreHighlights';
import { PublicStorePromotions } from './publicStore/PublicStorePromotions';
import { ChatWidget } from './chat/ChatWidget';
import { resolveStoreTemplate } from './publicStore/storeTemplateSystem';
import { StoreModelHeroShowcase } from './publicStore/StoreModelHeroShowcase';

interface PublicStoreViewProps {
  slug: string;
}

export const PublicStoreView: React.FC<PublicStoreViewProps> = ({ slug }) => {
  const { navigate } = useRouter();
  const { user } = useAuth();

  // Estados de datos de la tienda
  const [store, setStore] = useState<Store | null>(null);
  const [profile, setProfile] = useState<StoreProfileSettings | null>(null);
  const [appearance, setAppearance] = useState<StoreAppearanceSettings | null>(null);

  // Tiendas Públicas 2.0: El diseño actual aprobado es oficialmente la versión FREE de MAXINEGO
  // Modelos especiales de BASIC y PRO son activados según el plan del comercio.
  const activeTemplateId = resolveStoreTemplate(store, appearance);
  const [schedule, setSchedule] = useState<StoreScheduleDay[]>([]);
  const [shipping, setShipping] = useState<StoreShippingSettings | null>(null);
  const [scheduledOrders, setScheduledOrders] = useState<StoreScheduledOrdersSettings | null>(null);
  const [paymentSettings, setPaymentSettings] = useState<StorePaymentSettings | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [professionals, setProfessionals] = useState<ProfessionalItem[]>([]);
  const [fashionSettings, setFashionSettings] = useState<FashionSettings | null>(null);
  const [generalSettings, setGeneralSettings] = useState<GeneralSettings | null>(null);
  const [restaurantSettings, setRestaurantSettings] = useState<RestaurantSettings | null>(null);

  // Estados de Promociones y Cupones Activos (Fase 2 Parte 2)
  const [promotions, setPromotions] = useState<PromotionCode[]>([]);
  const [selectedPromo, setSelectedPromo] = useState<PromotionCode | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [notFound, setNotFound] = useState<boolean>(false);

  // Estados del Carrito y Modales
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [cartToast, setCartToast] = useState<{
    productName: string;
    quantity: number;
    price: number;
  } | null>(null);

  // Modal de Detalle de Producto
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Modal de Solicitud de Cita (Servicios)
  const [isBookingOpen, setIsBookingOpen] = useState(false);
  const [bookingServiceId, setBookingServiceId] = useState<string | undefined>(undefined);

  // Modal Guía de Tallas (Moda)
  const [isSizeGuideOpen, setIsSizeGuideOpen] = useState(false);

  // Modal Historial de Pedidos del Cliente
  const [isOrdersHistoryOpen, setIsOrdersHistoryOpen] = useState(false);

  // Modal / Visor de Estados Multimedia (Módulo 4: Plan PRO)
  const [activeStoryIndex, setActiveStoryIndex] = useState<number | null>(null);

  // Auto-cierre de la notificación de producto agregado
  useEffect(() => {
    if (cartToast) {
      const timer = setTimeout(() => {
        setCartToast(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [cartToast]);

  // Inyección reactiva y aislamiento del Web App Manifest específico de este comercio
  useStorePWA(
    store
      ? {
          id: store.id,
          name: profile?.name || store.name,
          slug: store.slug,
          logoUrl: profile?.logoUrl || store.logo_url,
          description: profile?.description,
          primaryColor: appearance?.brandPrimaryColor,
        }
      : null
  );

  // Cargar datos de la tienda según el slug
  useEffect(() => {
    let mounted = true;
    setIsLoading(true);
    setNotFound(false);

    // Limpieza inmediata del estado anterior para prevenir contaminación entre comercios
    setStore(null);
    setProfile(null);
    setAppearance(null);
    setProducts([]);
    setCategories([]);
    setProfessionals([]);
    setFashionSettings(null);
    setGeneralSettings(null);
    setRestaurantSettings(null);
    setCartItems([]);
    setPromotions([]);
    setSelectedPromo(null);
    setSelectedProduct(null);
    setIsBookingOpen(false);
    setIsOrdersHistoryOpen(false);

    resolveStoreBySlug(slug)
      .then((resolved) => {
        if (!mounted) return;
        if (resolved) {
          setStore(resolved);

          // Cargar configuración y catálogo aislado por tenant_id
          const tenantId = resolved.id;
          const prof = getStoreProfile(tenantId);
          const app = getCachedStoreAppearance(tenantId);
          const sch = getCachedStoreSchedule(tenantId);
          const shp = getCachedStoreShipping(tenantId);
          const sco = getCachedStoreScheduledOrders(tenantId);
          const paySet = getCachedStorePaymentSettings(tenantId);
          const prods = getCachedStoreProducts(tenantId);
          const cats = getCachedStoreCategories(tenantId);
          const profs = getStoreProfessionals(tenantId);
          const fsh = getFashionSettings(tenantId);
          const gen = getGeneralSettings(tenantId);
          const rest = getRestaurantSettings(tenantId);

          setProfile(prof);

          // Sincronizar datos oficiales de perfil desde Supabase
          fetchStoreProfile(tenantId).then((remoteProf) => {
            if (mounted && remoteProf) {
              setProfile(remoteProf);
            }
          });

          setAppearance(app);

          // Sincronizar configuración oficial de apariencia desde Supabase
          getStoreAppearance(tenantId).then((remoteApp) => {
            if (mounted && remoteApp) {
              setAppearance(remoteApp);
            }
          });

          setSchedule(sch);

          // Sincronizar horarios oficiales desde Supabase
          fetchStoreSchedule(tenantId).then((remoteSch) => {
            if (mounted && remoteSch) {
              setSchedule(remoteSch);
            }
          });

          setShipping(shp);

          // Sincronizar configuración oficial de envíos desde Supabase
          fetchStoreShipping(tenantId).then((remoteShp) => {
            if (mounted && remoteShp) {
              setShipping(remoteShp);
            }
          });

          setScheduledOrders(sco);

          // Sincronizar configuración oficial de pedidos programados desde Supabase
          fetchStoreScheduledOrders(tenantId).then((remoteSco) => {
            if (mounted && remoteSco) {
              setScheduledOrders(remoteSco);
            }
          });
          setPaymentSettings(paySet);

          // Sincronizar configuración oficial de métodos de pago desde Supabase
          fetchStorePaymentSettings(tenantId).then((remotePaySet) => {
            if (mounted && remotePaySet) {
              setPaymentSettings(remotePaySet);
            }
          });
          setProducts(prods);
          setCategories(cats);

          // Sincronizar productos oficiales desde Supabase (Fuente Canónica)
          fetchStoreProducts(tenantId).then((remoteProds) => {
            if (mounted && Array.isArray(remoteProds)) {
              setProducts(remoteProds);
            }
          });

          // Sincronizar categorías oficiales desde Supabase
          fetchStoreCategories(tenantId).then((remoteCats) => {
            if (mounted && Array.isArray(remoteCats)) {
              setCategories(remoteCats);
            }
          });

          // Sincronizar profesionales oficiales desde Supabase (H-02 Parte 1)
          fetchStoreProfessionals(tenantId).then((remoteProfs) => {
            if (mounted && Array.isArray(remoteProfs)) {
              setProfessionals(remoteProfs);
            }
          });

          setProfessionals(profs);
          setFashionSettings(fsh);
          setGeneralSettings(gen);
          setRestaurantSettings(rest);

          // Sincronizar configuraciones oficiales de moda desde Supabase (H-03B.1)
          fetchFashionSettings(tenantId).then((remoteFsh) => {
            if (mounted && remoteFsh) {
              setFashionSettings(remoteFsh);
            }
          });

          // Sincronizar configuración oficial de catálogo general desde Supabase (H-03B.1)
          fetchGeneralSettings(tenantId).then((remoteGen) => {
            if (mounted && remoteGen) {
              setGeneralSettings(remoteGen);
            }
          });

          // Sincronizar configuración oficial de gastronomía desde Supabase (H-03B.2)
          fetchRestaurantSettings(tenantId).then((remoteRest) => {
            if (mounted && remoteRest) {
              setRestaurantSettings(remoteRest);
            }
          });

          // Sincronizar promociones y cupones oficiales desde Supabase (Fase 2 Parte 2)
          fetchPublicActivePromotions(tenantId).then((remotePromos) => {
            if (mounted && Array.isArray(remotePromos)) {
              setPromotions(remotePromos);
            }
          });

          // Cargar carrito local del tenant
          const savedCart = getTenantCart(tenantId);
          setCartItems(savedCart);

          // Revisar si la URL trae un hash como #prod-123 para abrir el producto directamente
          if (window.location.hash.startsWith('#prod-')) {
            const targetProdId = window.location.hash.replace('#prod-', '');
            const targetProd = prods.find((p) => p.id === targetProdId);
            if (targetProd) {
              setSelectedProduct(targetProd);
            }
          }
        } else {
          setNotFound(true);
        }
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [slug]);

  // Sincronización en tiempo real de cambios de apariencia / modelo
  useEffect(() => {
    if (!store?.id) return;

    const handleAppearanceChanged = (event: any) => {
      const detail = event?.detail;
      if (detail && (detail.tenantId === store.id || detail.tenantId === store.slug) && detail.appearance) {
        setAppearance(detail.appearance);
      }
    };

    const handleStorage = (e: StorageEvent) => {
      if (store.id && e.key && (e.key.includes(store.id) || e.key.includes(store.slug))) {
        const fresh = getCachedStoreAppearance(store.id);
        if (fresh) {
          setAppearance(fresh);
        }
      }
    };

    window.addEventListener('maxinego:store_appearance_changed', handleAppearanceChanged);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener('maxinego:store_appearance_changed', handleAppearanceChanged);
      window.removeEventListener('storage', handleStorage);
    };
  }, [store?.id, store?.slug]);

  // Manejadores del Carrito (Canasta acumulativa)
  const handleAddToCart = (item: CartItem, openDrawer: boolean = false) => {
    if (!store) return;
    setCartItems((prev) => {
      // Verificar si ya existe el mismo producto con idénticas opciones y variantes
      const existingIndex = prev.findIndex(
        (it) =>
          it.productId === item.productId &&
          (it.selectedSize || '') === (item.selectedSize || '') &&
          (it.selectedColor?.name || '') === (item.selectedColor?.name || '') &&
          JSON.stringify(it.selectedModifiers || []) === JSON.stringify(item.selectedModifiers || []) &&
          (it.kitchenNotes || '').trim().toLowerCase() === (item.kitchenNotes || '').trim().toLowerCase() &&
          (it.serviceDetails?.professionalName || '') === (item.serviceDetails?.professionalName || '')
      );

      let updated: CartItem[];
      if (existingIndex >= 0) {
        updated = [...prev];
        updated[existingIndex].quantity += item.quantity;
      } else {
        updated = [...prev, item];
      }

      saveTenantCart(store.id, updated);
      return updated;
    });

    setCartToast({
      productName: item.name,
      quantity: item.quantity,
      price: item.price,
    });

    if (openDrawer) {
      setIsCartOpen(true);
    }
  };

  const handleQuickAddToCart = (product: Product) => {
    if (!store) return;
    const item: CartItem = {
      id: `${product.id}-${Date.now()}`,
      productId: product.id,
      name: product.name,
      price: product.price,
      basePrice: product.price,
      quantity: 1,
      imageUrl: product.image_url,
      storeType: store.store_type,
    };
    handleAddToCart(item, false);
  };

  const handleUpdateQuantity = (itemId: string, newQty: number) => {
    if (!store) return;
    setCartItems((prev) => {
      let updated: CartItem[];
      if (newQty <= 0) {
        updated = prev.filter((it) => it.id !== itemId);
      } else {
        updated = prev.map((it) => (it.id === itemId ? { ...it, quantity: newQty } : it));
      }
      saveTenantCart(store.id, updated);
      return updated;
    });
  };

  const handleRemoveItem = (itemId: string) => {
    if (!store) return;
    setCartItems((prev) => {
      const updated = prev.filter((it) => it.id !== itemId);
      saveTenantCart(store.id, updated);
      return updated;
    });
  };

  const handleClearCart = () => {
    if (!store) return;
    clearTenantCart(store.id);
    setCartItems([]);
  };

  const handleProceedToCheckout = () => {
    setIsCartOpen(false);
    setIsCheckoutOpen(true);
  };

  const handleSelectPromo = (promo: PromotionCode) => {
    setSelectedPromo(promo);
  };

  const handleRemovePromo = () => {
    setSelectedPromo(null);
  };

  const handleOrderCompleted = () => {
    setCartItems([]);
    setSelectedPromo(null);
  };

  const handleRequestAppointment = (serviceId?: string) => {
    setBookingServiceId(serviceId);
    setIsBookingOpen(true);
  };

  if (isLoading) {
    return <RouteSkeleton kind="store" />;
  }

  if (notFound || !store || !profile || !appearance || !shipping || !scheduledOrders) {
    return (
      <div className="max-w-2xl mx-auto my-12 p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center shadow-xs transition-colors">
        <StoreIcon className="w-12 h-12 text-slate-400 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Comercio no encontrado</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
          No existe ningún comercio activo registrado con el slug{' '}
          <code className="text-blue-600 dark:text-blue-400 font-mono bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
            "{slug}"
          </code>.
        </p>
        <button
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition cursor-pointer shadow-xs"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver al inicio
        </button>
      </div>
    );
  }

  const isRestaurant = store.store_type === 'restaurante';
  const isFashion = store.store_type === 'moda';
  const isServices = store.store_type === 'servicios';
  const isRetail =
    store.store_type === 'retail' ||
    store.store_type === 'supermercado';

  const primaryColor = isFashion
    ? '#1c1917'
    : isServices
    ? '#059669'
    : isRetail
    ? '#2563eb'
    : isRestaurant
    ? (appearance.brandPrimaryColor && appearance.brandPrimaryColor !== '#2563eb' ? appearance.brandPrimaryColor : '#d97706')
    : (appearance.brandPrimaryColor || '#2563eb');
  const totalCartCount = cartItems.reduce((acc, it) => acc + it.quantity, 0);
  const cartSubtotal = cartItems.reduce((acc, it) => acc + it.price * it.quantity, 0);

  const getAccentClass = () => {
    if (store.slug?.includes('andes') || store.store_type === 'retail' || store.store_type === 'supermercado') {
      return 'text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300';
    }
    if (store.slug?.includes('spa') || store.store_type === 'servicios') {
      return 'text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300';
    }
    if (store.slug?.includes('milano') || store.store_type === 'moda') {
      return 'text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300';
    }
    return 'text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300';
  };

  // Cantidad de pedidos pasados del cliente en esta tienda
  const pastOrdersCount = getCustomerPlacedOrders(store.id).length;
  const pastAppointmentsCount = getCustomerAppointments(store.id).length;
  const totalCustomerActivity = pastOrdersCount + pastAppointmentsCount;

  // Banners comerciales: Exclusivo para planes BASIC y PRO con banners registrados
  const canShowBanners =
    isStorePaidPlan(store) &&
    Array.isArray(appearance.banners) &&
    appearance.banners.length > 0;

  // Estados multimedia: Exclusivo para Plan PRO con estados registrados
  const canShowStories =
    isStoreProPlan(store) &&
    Array.isArray(appearance.stories) &&
    appearance.stories.length > 0;

  return (
    <div
      data-template-id={activeTemplateId}
      className={`w-full min-h-screen flex flex-col ${
        isFashion
          ? 'bg-[#FAF8F5] dark:bg-[#101012] text-stone-900 dark:text-stone-100'
          : isServices
          ? 'bg-[#F4F7F4] dark:bg-[#09100C] text-stone-900 dark:text-stone-100'
          : isRetail
          ? 'bg-[#F4F7FB] dark:bg-[#070D18] text-slate-900 dark:text-slate-100'
          : isRestaurant
          ? 'bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100'
          : 'bg-slate-50 dark:bg-[#090d16] text-slate-900 dark:text-slate-100'
      }`}
    >
      {/* BARRA DE NAVEGACIÓN EXCLUSIVA DE LA TIENDA */}
      <header
        className={`border-b sticky top-0 z-30 transition-colors backdrop-blur-md ${
          isFashion
            ? 'border-stone-200/80 dark:border-stone-800/80 bg-[#FAF8F5]/90 dark:bg-[#101012]/90'
            : isServices
            ? 'border-emerald-900/10 dark:border-emerald-500/15 bg-[#F4F7F4]/90 dark:bg-[#09100C]/90'
            : isRetail
            ? 'border-blue-900/10 dark:border-blue-500/15 bg-[#F4F7FB]/90 dark:bg-[#070D18]/90'
            : isRestaurant
            ? 'border-stone-200 dark:border-stone-800/80 bg-white/80 dark:bg-stone-950/80'
            : 'border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-950/80'
        }`}
      >
        <div className="h-14 flex items-center justify-between px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto w-full">
          {/* Identidad de marca del comercio */}
          <div className="flex items-center gap-2.5 min-w-0">
            {profile.logoUrl || store.logo_url ? (
              <img
                src={profile.logoUrl || store.logo_url}
                alt={profile.name || store.name}
                className="w-7 h-7 rounded-lg object-cover shrink-0 border border-stone-200/80 dark:border-stone-700/80 shadow-2xs"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : null}
            <div
              className={`w-7 h-7 rounded-lg items-center justify-center font-bold text-xs shrink-0 text-white shadow-2xs ${
                profile.logoUrl || store.logo_url ? 'hidden' : 'flex'
              }`}
              style={{ backgroundColor: primaryColor }}
            >
              {(profile.name || store.name).charAt(0).toUpperCase()}
            </div>
            <span className="font-bold text-xs sm:text-sm text-stone-900 dark:text-stone-100 truncate max-w-[150px] sm:max-w-[260px]">
              {profile.name || store.name}
            </span>
          </div>

          {/* Utilidades de la tienda */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Botón PWA condicional de la tienda */}
            <StorePWAInstallButton
              storeName={profile.name || store.name}
              storeSlug={store.slug}
              tenantId={store.id}
              primaryColor={primaryColor}
            />

            {/* 1. Un solo selector de tema */}
            <ThemeToggle />

            {/* 2. Acceso a pedidos / citas */}
            <button
              onClick={() => setIsOrdersHistoryOpen(true)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-xl border transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs ${
                isFashion
                  ? 'border-stone-200/80 dark:border-stone-800 text-stone-700 dark:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-stone-900'
                  : isServices
                  ? 'border-emerald-900/15 dark:border-emerald-500/20 text-stone-700 dark:text-stone-200 hover:bg-emerald-100/50 dark:hover:bg-[#121B15]'
                  : isRetail
                  ? 'border-blue-900/15 dark:border-blue-500/20 text-slate-700 dark:text-slate-200 hover:bg-blue-100/50 dark:hover:bg-[#0F172A]'
                  : 'border-stone-200 dark:border-stone-800 text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800'
              }`}
              title="Ver mis pedidos o citas anteriores"
            >
              <History
                className={`w-3.5 h-3.5 ${
                  isFashion
                    ? 'text-stone-700 dark:text-rose-300'
                    : isServices
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : isRetail
                    ? 'text-blue-600 dark:text-blue-400'
                    : isRestaurant
                    ? 'text-amber-500'
                    : 'text-blue-500'
                }`}
              />
              <span>{isServices ? 'Mis Citas' : 'Mis Pedidos'}</span>
              {totalCustomerActivity > 0 && (
                <span
                  className={`w-4 h-4 rounded-full text-white text-[10px] font-bold flex items-center justify-center ${
                    isFashion
                      ? 'bg-stone-900 dark:bg-rose-500'
                      : isServices
                      ? 'bg-emerald-700'
                      : isRestaurant
                      ? 'bg-amber-600'
                      : 'bg-blue-600'
                  }`}
                >
                  {totalCustomerActivity}
                </span>
              )}
            </button>

            {/* 3. Botón de Carrito / Canasta / Citas */}
            <button
              onClick={() => setIsCartOpen(true)}
              id="public-store-cart-trigger"
              className={
                isFashion
                  ? 'bg-stone-900 hover:bg-stone-800 text-white dark:bg-white dark:hover:bg-stone-200 dark:text-stone-950 font-bold text-xs px-3.5 py-1.5 rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer active:scale-95'
                  : isServices
                  ? 'bg-emerald-800 hover:bg-emerald-700 text-white dark:bg-emerald-600 dark:hover:bg-emerald-500 font-bold text-xs px-3.5 py-1.5 rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer active:scale-95'
                  : isRestaurant
                  ? 'bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs px-3.5 py-1.5 rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer active:scale-95'
                  : 'bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-3.5 py-1.5 rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer active:scale-95'
              }
              title={isServices ? "Ver citas seleccionadas" : "Ver canasta de compras"}
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>{isServices ? 'Citas' : 'Canasta'}</span>
              {totalCartCount > 0 && (
                <span
                  className={
                    isFashion
                      ? 'px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/15 text-rose-600 dark:text-rose-300 border border-rose-500/20'
                      : isServices
                      ? 'px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-950/40 text-emerald-200 border border-emerald-500/30'
                      : 'px-1.5 py-0.5 bg-black/25 text-white rounded text-[10px] font-bold'
                  }
                >
                  {totalCartCount}
                </span>
              )}
            </button>

            {/* Acceso para el dueño de la tienda si está autenticado */}
            {user?.tenantId === store.id && (
              <button
                onClick={() => navigate(`/admin/${store.id}`)}
                className={
                  isFashion
                    ? 'hidden sm:inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-xl bg-stone-100 dark:bg-stone-900 text-stone-800 dark:text-stone-200 border border-stone-200/80 dark:border-stone-800 hover:bg-stone-200 transition cursor-pointer'
                    : isServices
                    ? 'hidden sm:inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-xl bg-emerald-50 dark:bg-[#121B15] text-emerald-800 dark:text-emerald-300 border border-emerald-900/15 dark:border-emerald-500/20 hover:bg-emerald-100 transition cursor-pointer'
                    : 'hidden sm:inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/40 hover:bg-amber-100 transition cursor-pointer'
                }
              >
                <span>Admin</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* CONTENEDOR PRINCIPAL: ESCALA COMPLETA Y ANCHO AMPLIO */}
      <div className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-8">
        {/* CABECERA PÚBLICA DE LA TIENDA (Sección 1) */}
        <PublicStoreHeader
          store={store}
          profile={profile}
          appearance={appearance}
          schedule={schedule}
          cartCount={totalCartCount}
          onOpenCart={() => setIsCartOpen(true)}
          onOpenOrders={() => setIsOrdersHistoryOpen(true)}
          primaryColor={primaryColor}
          templateId={activeTemplateId}
          categories={categories}
          products={products}
          selectedCategoryId={selectedCategoryId}
          onSelectCategory={setSelectedCategoryId}
        />

        {/* HERO SHOWCASE DEL MODELO ACTIVO (Exclusivo para modelos especiales; Oculto en Plan FREE y en G5-G8 con cabecera integrada) */}
        <StoreModelHeroShowcase
          templateId={activeTemplateId}
          storeName={profile?.name || store.name}
          primaryColor={primaryColor}
          categories={categories}
        />

        {/* BANNERS COMERCIALES (Módulo 2: Exclusivo para Planes BASIC y PRO con banners registrados) */}
        {canShowBanners && appearance.banners && (
          <StoreBannersCarousel
            banners={appearance.banners}
            brandPrimaryColor={primaryColor}
            storeName={store.name}
            templateId={activeTemplateId}
          />
        )}

        {/* ESTADOS MULTIMEDIA (Módulo 4: Exclusivo para Plan PRO con estados registrados) */}
        {canShowStories && appearance.stories && (
          <StoreStoriesBar
            stories={appearance.stories}
            storeName={profile.name || store.name}
            storeLogoUrl={profile.logoUrl || store.logo_url}
            brandColor={primaryColor}
            onOpenStory={(idx) => setActiveStoryIndex(idx)}
          />
        )}

        {/* DESTACADOS DEL COMERCIO (Sistema Dinámico, Configurable y Auténtico) */}
        <StoreHighlights
          highlights={appearance?.highlights}
          layout={appearance?.highlightsLayout || 'balanced'}
          showHighlights={appearance?.showHighlights ?? true}
          brandPrimaryColor={primaryColor}
          brandSecondaryColor={appearance?.brandSecondaryColor}
          brandAccentColor={appearance?.brandAccentColor}
          storeType={store.store_type}
        />

        {/* PROMOCIONES & CUPONES ACTIVOS (Fase 2 Parte 2) */}
        <PublicStorePromotions
          promotions={promotions}
          selectedPromo={selectedPromo}
          onSelectPromo={handleSelectPromo}
          onRemovePromo={handleRemovePromo}
          primaryColor={primaryColor}
          storeType={store.store_type}
        />

        {/* SECCIÓN PRINCIPAL: CATÁLOGO PÚBLICO (Sección 2) */}
        <div id="catalog-view-section" className="space-y-4 pt-2">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pb-2 border-b border-stone-200/70 dark:border-stone-800/70">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full inline-block shrink-0"
                  style={{ backgroundColor: primaryColor }}
                />
                <span
                  className="text-[11px] font-bold uppercase tracking-wider"
                  style={{ color: primaryColor }}
                >
                  {store.store_type === 'servicios'
                    ? 'Nuestros Servicios'
                    : store.store_type === 'moda'
                    ? 'Catálogo & Colección'
                    : isRestaurant
                    ? 'Menú & Carta'
                    : 'Catálogo de Productos'}
                </span>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-stone-900 dark:text-white">
                {store.store_type === 'servicios'
                  ? 'Servicios & Sesiones Disponibles'
                  : store.store_type === 'moda'
                  ? 'Prendas & Colecciones'
                  : isRestaurant
                  ? 'Especialidades & Carta'
                  : 'Productos Disponibles'}
              </h2>
              <p className="text-xs text-stone-500 dark:text-stone-400 max-w-xl">
                {store.store_type === 'servicios'
                  ? `Agenda tus sesiones en ${profile.name || store.name} con atención directa y personalizada.`
                  : `Explora y realiza tus pedidos en ${profile.name || store.name} con confirmación directa por WhatsApp.`}
              </p>
            </div>
            <div className="text-xs font-semibold text-stone-600 dark:text-stone-300 shrink-0 self-start sm:self-auto flex items-center gap-2 px-3 py-1.5 rounded-full bg-stone-100/80 dark:bg-stone-800/80 border border-stone-200/80 dark:border-stone-700/60 shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>{products.filter((p) => p.status === 'activo').length} disponibles</span>
            </div>
          </div>

          <CatalogView
            storeType={store.store_type}
            storeName={profile.name || store.name}
            products={products}
            categories={categories}
            fashionSettings={fashionSettings || undefined}
            generalSettings={generalSettings || undefined}
            onSelectProduct={(p) => setSelectedProduct(p)}
            onQuickAddToCart={handleQuickAddToCart}
            onRequestAppointment={
              store.store_type === 'servicios'
                ? (serviceId) => handleRequestAppointment(serviceId)
                : undefined
            }
            onOpenSizeGuide={
              store.store_type === 'moda' && fashionSettings
                ? () => setIsSizeGuideOpen(true)
                : undefined
            }
            primaryColor={primaryColor}
            brandSecondaryColor={appearance?.brandSecondaryColor}
            brandAccentColor={appearance?.brandAccentColor}
            templateId={activeTemplateId}
            selectedCategoryId={selectedCategoryId}
            onSelectCategory={setSelectedCategoryId}
          />
        </div>



        {/* BLOQUE DE ATENCIÓN DIRECTA Y CONSULTAS */}
        {(profile.whatsapp || profile.phone) && (() => {
          const rawWa = (profile.whatsapp || profile.phone || '').replace(/\D/g, '');
          const waNumber = rawWa.startsWith('591') ? rawWa : `591${rawWa}`;
          return (
            <div className="my-8 sm:my-10 p-6 sm:p-8 rounded-3xl border flex flex-col sm:flex-row items-center justify-between gap-6 shadow-2xs transition bg-gradient-to-br from-white via-white to-stone-50/70 dark:from-stone-900/90 dark:via-stone-900/70 dark:to-stone-950/80 border-stone-200/90 dark:border-stone-800">
              <div className="space-y-1.5 text-center sm:text-left">
                <span
                  className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border inline-block"
                  style={{
                    backgroundColor: `${primaryColor}14`,
                    color: primaryColor,
                    borderColor: `${primaryColor}30`,
                  }}
                >
                  Atención Directa
                </span>
                <h4 className="text-lg sm:text-xl font-extrabold text-stone-900 dark:text-white">
                  ¿Tienes alguna consulta antes de realizar tu pedido?
                </h4>
                <p className="text-xs sm:text-sm text-stone-600 dark:text-stone-400 max-w-xl leading-relaxed">
                  Contáctanos directamente por WhatsApp para asistirte con consultas sobre productos, pedidos o disponibilidad de {profile.name || store.name}.
                </p>
              </div>
              <a
                href={`https://wa.me/${waNumber}?text=${encodeURIComponent(
                  `Hola ${profile.name || store.name}, tengo una consulta sobre sus productos.`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 whitespace-nowrap min-h-[44px] px-6 py-2.5 rounded-xl font-bold text-xs shadow-xs transition-all flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white active:scale-95 cursor-pointer"
              >
                <MessageCircle className="w-4 h-4 fill-current" />
                <span>Contactar por WhatsApp</span>
              </a>
            </div>
          );
        })()}

        {/* SECCIÓN: UBICACIÓN VISIBLE DEL COMERCIO (Google Maps - Módulo 5) */}
        {profile?.location?.isConfigured && (
          <StoreLocationMap
            storeName={profile.name || store.name}
            storeAddress={profile.address}
            location={profile.location}
            primaryColor={primaryColor}
          />
        )}
      </div>

      {/* 3. FIRMA DE PIE DE PÁGINA ("Potenciado por Maxinego.") */}
      <footer
        className={`border-t mt-14 py-8 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto w-full ${
          isFashion
            ? 'border-stone-200/80 dark:border-stone-800/80'
            : isServices
            ? 'border-emerald-900/10 dark:border-emerald-500/15'
            : isRetail
            ? 'border-blue-900/10 dark:border-blue-500/15'
            : 'border-stone-200 dark:border-stone-800/80'
        }`}
      >
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
          {/* Lado Izquierdo (Comercio) */}
          <p className="text-stone-500 dark:text-stone-400 font-normal">
            © 2026 {profile.name || store.name} · Todos los derechos reservados.
          </p>

          {/* Lado Derecho (Sello de Plataforma MAXINEGO) */}
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-1.5 text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200 font-medium transition-colors cursor-pointer group"
          >
            <span className="text-stone-500 dark:text-stone-400">Potenciado por</span>
            <span className="inline-flex items-center gap-1.5">
              <img
                src="/icon.svg"
                alt="MAXINEGO"
                className="w-3.5 h-3.5 rounded-[3px] inline-block shrink-0 opacity-80 group-hover:opacity-100 transition-opacity"
              />
              <span
                className="font-bold tracking-tight transition-opacity"
                style={{ color: primaryColor }}
              >
                Maxinego.
              </span>
            </span>
            <span className="font-semibold text-stone-400 dark:text-stone-500 group-hover:text-stone-600 dark:group-hover:text-stone-300 transition-colors ml-0.5">
              · Crea tu tienda digital →
            </span>
          </button>
        </div>
      </footer>

      {/* NOTIFICACIÓN TOAST: PRODUCTO AGREGADO */}
      {cartToast && (
        <div
          id="cart-added-toast"
          className="fixed bottom-24 right-4 sm:right-6 z-40 max-w-sm w-[calc(100vw-2rem)] sm:w-auto p-3.5 rounded-2xl bg-white/95 dark:bg-slate-900/95 border border-emerald-500/40 shadow-xl backdrop-blur-md animate-in slide-in-from-bottom-3 duration-200"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <Check className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0 text-xs">
              <p className="font-bold text-slate-900 dark:text-white truncate">
                ¡{cartToast.quantity} {cartToast.quantity === 1 ? 'unidad agregada' : 'unidades agregadas'}!
              </p>
              <p className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
                {cartToast.productName} • <span className="text-emerald-600 dark:text-emerald-400 font-bold">{totalCartCount} {totalCartCount === 1 ? 'unidad' : 'unidades'}</span> en canasta
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                id="btn-toast-continue"
                onClick={() => setCartToast(null)}
                className="px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-[11px] transition-all duration-150 active:scale-95 cursor-pointer"
                title="Seguir comprando"
              >
                Seguir
              </button>
              <button
                type="button"
                id="btn-toast-view-cart"
                onClick={() => {
                  setCartToast(null);
                  setIsCartOpen(true);
                }}
                style={!isFashion ? { backgroundColor: primaryColor } : undefined}
                className={
                  isFashion
                    ? 'px-3 py-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-white dark:bg-white dark:hover:bg-stone-200 dark:text-stone-950 font-bold text-[11px] shadow transition-all duration-150 active:scale-95 cursor-pointer'
                    : 'px-3 py-1.5 rounded-xl text-white font-bold text-[11px] shadow hover:opacity-90 transition-all duration-150 active:scale-95 cursor-pointer'
                }
                title="Abrir el carrito"
              >
                Ver Carrito
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BOTÓN FLOTANTE DEL CARRITO (Mobile & Desktop) */}
      {cartItems.length > 0 && (
        <div className="fixed bottom-5 right-4 sm:right-6 z-40 animate-in slide-in-from-bottom-5 duration-300">
          <button
            id="floating-cart-btn"
            onClick={() => setIsCartOpen(true)}
            style={!isFashion ? { backgroundColor: primaryColor } : undefined}
            className={
              isFashion
                ? 'flex items-center gap-3 px-4 sm:px-5 py-3 rounded-2xl bg-stone-900 hover:bg-stone-800 text-white dark:bg-white dark:hover:bg-stone-200 dark:text-stone-950 font-bold text-xs shadow-2xl transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer border border-stone-800 dark:border-stone-200'
                : 'flex items-center gap-3 px-4 sm:px-5 py-3 rounded-2xl text-white font-bold text-xs shadow-xl hover:opacity-95 transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer border border-white/20'
            }
            title="Ver los productos en tu canasta acumulativa"
          >
            <div className="relative shrink-0">
              <ShoppingBag className="w-5 h-5 text-current" />
              <span
                className={
                  isFashion
                    ? 'absolute -top-2.5 -right-2.5 min-w-5 h-5 px-1.5 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-300 border border-rose-500/20 text-[11px] font-black flex items-center justify-center shadow'
                    : 'absolute -top-2.5 -right-2.5 min-w-5 h-5 px-1.5 rounded-full bg-white text-slate-950 text-[11px] font-black flex items-center justify-center shadow-md'
                }
              >
                {totalCartCount}
              </span>
            </div>
            <div className="text-left">
              <p
                className={`text-[10px] uppercase font-bold tracking-wider select-none ${
                  isFashion ? 'text-white/85 dark:text-stone-900/80' : 'text-white/90'
                }`}
              >
                Canasta ({totalCartCount} {totalCartCount === 1 ? 'unidad' : 'unidades'})
              </p>
              <PriceDisplay
                amount={cartSubtotal}
                size="sm"
                colorVariant={isFashion ? 'fashion' : 'white'}
              />
            </div>
          </button>
        </div>
      )}

      {/* MODAL: DETALLE DEL PRODUCTO */}
      {selectedProduct && (
        <ProductDetailModal
          product={selectedProduct}
          storeType={store.store_type}
          storeName={profile.name || store.name}
          isPaidPlan={isStorePaidPlan(store)}
          categories={categories}
          fashionSettings={fashionSettings || undefined}
          restaurantSettings={restaurantSettings || undefined}
          onAddToCart={(item) => handleAddToCart(item, false)}
          onOpenCart={() => setIsCartOpen(true)}
          onRequestAppointment={
            store.store_type === 'servicios'
              ? (serviceId) => {
                  setSelectedProduct(null);
                  handleRequestAppointment(serviceId);
                }
              : undefined
          }
          onOpenSizeGuide={
            store.store_type === 'moda' && fashionSettings
              ? () => setIsSizeGuideOpen(true)
              : undefined
          }
          onClose={() => setSelectedProduct(null)}
          primaryColor={primaryColor}
        />
      )}

      {/* DRAWER: CARRITO DE COMPRAS */}
      <CartDrawer
        isOpen={isCartOpen}
        items={cartItems}
        onClose={() => setIsCartOpen(false)}
        onUpdateQuantity={handleUpdateQuantity}
        onRemoveItem={handleRemoveItem}
        onClearCart={handleClearCart}
        onProceedToCheckout={handleProceedToCheckout}
        primaryColor={primaryColor}
        storeName={profile.name || store.name}
        selectedPromo={selectedPromo}
        onSelectPromo={handleSelectPromo}
        onRemovePromo={handleRemovePromo}
        activePromotions={promotions}
      />

      {/* MODAL: CHECKOUT DE PEDIDO */}
      {isCheckoutOpen && (
        <CheckoutModal
          store={store}
          profile={profile}
          shippingSettings={shipping}
          scheduledSettings={scheduledOrders}
          paymentSettings={paymentSettings}
          items={cartItems}
          onClose={() => setIsCheckoutOpen(false)}
          onOrderCompleted={handleOrderCompleted}
          primaryColor={primaryColor}
          initialPromotion={selectedPromo}
          activePromotions={promotions}
          onSelectPromo={handleSelectPromo}
          onRemovePromo={handleRemovePromo}
        />
      )}

      {/* MODAL: SOLICITUD DE CITA (SERVICIOS) */}
      {isBookingOpen && store && profile && (
        <ServiceBookingModal
          tenantId={store.id}
          storeName={store.name}
          storeWhatsapp={profile.whatsapp || profile.phone || ''}
          services={products.filter((p) => p.status === 'activo')}
          professionals={professionals}
          preselectedServiceId={bookingServiceId}
          onClose={() => setIsBookingOpen(false)}
          primaryColor={primaryColor}
        />
      )}

      {/* MODAL: GUÍA DE TALLAS & CAMBIOS (MODA) */}
      {isSizeGuideOpen && fashionSettings && (
        <FashionSizeGuideModal
          settings={fashionSettings}
          onClose={() => setIsSizeGuideOpen(false)}
          primaryColor={primaryColor}
        />
      )}

      {/* MODAL: MIS PEDIDOS & CITAS */}
      {isOrdersHistoryOpen && store && profile && (
        <CustomerOrdersModal
          tenantId={store.id}
          storeName={store.name}
          storeWhatsapp={profile.whatsapp || profile.phone || ''}
          onClose={() => setIsOrdersHistoryOpen(false)}
          primaryColor={primaryColor}
        />
      )}

      {/* VISUALIZADOR DE ESTADOS (Módulo 4: Exclusivo para Plan PRO) */}
      {canShowStories && appearance.stories && (
        <StoreStoryViewerModal
          stories={appearance.stories}
          initialIndex={activeStoryIndex ?? 0}
          isOpen={activeStoryIndex !== null}
          onClose={() => setActiveStoryIndex(null)}
          storeName={profile.name || store.name}
          storeLogoUrl={profile.logoUrl || store.logo_url}
          brandColor={primaryColor}
        />
      )}

      {/* CHATBOT DE ATENCIÓN INTELIGENTE (GOOGLE GEMINI + SUPABASE) */}
      {store && (
        <ChatWidget
          storeId={store.id}
          storeName={profile?.name || store.name}
          storeType={store.store_type}
          primaryColor={primaryColor}
          hasFloatingCart={cartItems.length > 0}
          qrImageUrl={paymentSettings?.qrImageUrl || null}
          storeWhatsapp={profile?.whatsapp || profile?.phone || ''}
        />
      )}
    </div>
  );
};
