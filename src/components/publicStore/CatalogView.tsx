import React, { useState, useMemo, useEffect } from 'react';
import {
  Search,
  Star,
  ShoppingBag,
  Share2,
  Check,
  Clock,
  User,
  Utensils,
  Shirt,
  Briefcase,
  Store as StoreIcon,
  Ruler,
  Calendar,
  Plus,
  Tag,
  X,
} from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  Product,
  Category,
  StoreType,
  FashionSettings,
  GeneralSettings,
} from '../../types';
import { getVerticalMotionProfile } from './motionSystem';
import { getTemplateVisualClasses, getTemplateDefinition } from './storeTemplateSystem';

interface CatalogViewProps {
  storeType: StoreType;
  storeName?: string;
  products: Product[];
  categories: Category[];
  fashionSettings?: FashionSettings;
  generalSettings?: GeneralSettings;
  onSelectProduct: (product: Product) => void;
  onQuickAddToCart: (product: Product) => void;
  onRequestAppointment?: (serviceId: string) => void;
  onOpenSizeGuide?: () => void;
  primaryColor?: string;
  brandSecondaryColor?: string;
  brandAccentColor?: string;
  templateId?: string;
  selectedCategoryId?: string;
  onSelectCategory?: (categoryId: string) => void;
}

// Determinar el color de texto (blanco o negro suave) según el contraste del color de marca
function getContrastColor(hexColor?: string): '#ffffff' | '#18181b' {
  if (!hexColor || !hexColor.startsWith('#')) return '#ffffff';
  let c = hexColor.substring(1);
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  if (c.length !== 6) return '#ffffff';
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 160 ? '#18181b' : '#ffffff';
}

export const CatalogView: React.FC<CatalogViewProps> = ({
  storeType,
  storeName,
  products,
  categories,
  generalSettings,
  onSelectProduct,
  onQuickAddToCart,
  onRequestAppointment,
  onOpenSizeGuide,
  primaryColor = '#2563eb',
  templateId,
  selectedCategoryId: propSelectedCategoryId,
  onSelectCategory: propOnSelectCategory,
}) => {
  const isSpecialTemplate = Boolean(templateId && templateId !== 'free');
  const templateVisuals = getTemplateVisualClasses(templateId);

  const isRestaurant = storeType === 'restaurante';
  const isFashion = storeType === 'moda';
  const isServices = storeType === 'servicios';
  const shouldReduceMotion = useReducedMotion();

  // Color adaptativo según modelo activo o paleta de marca
  const getButtonVisuals = (productAvailable: boolean) => {
    if (!productAvailable) {
      return { backgroundColor: undefined, color: undefined };
    }
    if (templateId === 'g5') {
      return { backgroundColor: '#EA580C', color: '#ffffff' };
    }
    if (templateId === 'g6') {
      return { backgroundColor: '#059669', color: '#ffffff' };
    }
    if (templateId === 'g7') {
      return { backgroundColor: '#B45309', color: '#ffffff' };
    }
    if (templateId === 'g8') {
      return { backgroundColor: '#F59E0B', color: '#18181b' };
    }
    return { backgroundColor: primaryColor, color: contrastColor };
  };

  // Estilo visual del selector de categorías según modelo activo
  const getActiveTabStyle = (isSelected: boolean) => {
    if (!isSelected) return undefined;
    if (templateId === 'g5') {
      return {
        backgroundColor: '#EA580C',
        color: '#ffffff',
        boxShadow: '0 2px 10px -2px rgba(234, 88, 12, 0.45)',
      };
    }
    if (templateId === 'g6') {
      return {
        backgroundColor: '#059669',
        color: '#ffffff',
        boxShadow: '0 2px 10px -2px rgba(5, 150, 105, 0.45)',
      };
    }
    if (templateId === 'g7') {
      return {
        backgroundColor: '#B45309',
        color: '#ffffff',
        boxShadow: '0 2px 10px -2px rgba(180, 83, 9, 0.45)',
      };
    }
    if (templateId === 'g8') {
      return {
        backgroundColor: '#F59E0B',
        color: '#18181b',
        boxShadow: '0 2px 10px -2px rgba(245, 158, 11, 0.45)',
      };
    }
    return {
      backgroundColor: primaryColor,
      color: contrastColor,
      boxShadow: `0 2px 10px -2px ${primaryColor}40`,
    };
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(24);

  // Evita recalcular el catálogo completo en cada pulsación del teclado.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearchQuery(searchQuery), 250);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const [internalSelectedCategoryId, setInternalSelectedCategoryId] = useState<string>('all');

  const selectedCategoryId = propSelectedCategoryId !== undefined ? propSelectedCategoryId : internalSelectedCategoryId;
  const setSelectedCategoryId = (id: string) => {
    setInternalSelectedCategoryId(id);
    if (propOnSelectCategory) {
      propOnSelectCategory(id);
    }
  };
  const [copiedProductId, setCopiedProductId] = useState<string | null>(null);
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});

  // Filtrar únicamente productos activos para la vitrina pública
  const publicProducts = useMemo(
    () => products.filter((p) => p.status === 'activo'),
    [products]
  );

  // Categorías activas
  const activeCategories = useMemo(
    () => categories.filter((c) => c.status === 'activo'),
    [categories]
  );

  // Mapa de nombres de categorías por ID para asociación rápida y verídica
  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories]
  );

  // Filtrado reactivo por categoría y texto de búsqueda (nombre, descripción, especialidad)
  const filteredProducts = useMemo(() => {
    const q = debouncedSearchQuery.trim().toLowerCase();
    return publicProducts.filter((p) => {
      const matchesCategory =
        selectedCategoryId === 'all' || p.category_id === selectedCategoryId;

      const matchesSearch =
        q === '' ||
        p.name.toLowerCase().includes(q) ||
        (p.description && p.description.toLowerCase().includes(q)) ||
        (p.attributes?.specialty &&
          String(p.attributes.specialty).toLowerCase().includes(q));

      return matchesCategory && matchesSearch;
    });
  }, [publicProducts, selectedCategoryId, debouncedSearchQuery]);

  useEffect(() => {
    setVisibleCount(24);
  }, [selectedCategoryId, debouncedSearchQuery]);

  const visibleProducts = useMemo(
    () => filteredProducts.slice(0, visibleCount),
    [filteredProducts, visibleCount]
  );

  // Compartir enlace del producto o copiar al portapapeles
  const handleShareProduct = (e: React.MouseEvent, productId: string, productName: string) => {
    e.stopPropagation();
    const url = `${window.location.origin}${window.location.pathname}#prod-${productId}`;
    if (navigator.share) {
      navigator.share({
        title: productName,
        url: url,
      }).catch(() => {
        copyToClipboard(url, productId);
      });
    } else {
      copyToClipboard(url, productId);
    }
  };

  const copyToClipboard = (text: string, productId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedProductId(productId);
    setTimeout(() => setCopiedProductId(null), 2500);
  };

  const contrastColor = getContrastColor(primaryColor);
  const layout = generalSettings?.catalogLayout || 'grid';
  const isListLayout = layout === 'list';

  // Perfil de movimiento adaptativo por vertical (Gastronomía, Moda, Servicios, General)
  const motionProfile = getVerticalMotionProfile(storeType, shouldReduceMotion);

  // Variantes de animación para microinteracciones fluidas
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: motionProfile.stagger,
        delayChildren: shouldReduceMotion ? 0 : 0.035,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: motionProfile.subtleY },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: motionProfile.duration, ease: motionProfile.ease },
    },
  };

  // Escala sutil de hover fotográfico adaptada al tono de la vertical
  const imageHoverClass = shouldReduceMotion
    ? ''
    : isRestaurant
    ? 'group-hover:scale-[1.035]'
    : isFashion
    ? 'group-hover:scale-[1.025]'
    : isServices
    ? 'group-hover:scale-[1.02]'
    : 'group-hover:scale-[1.03]';

  return (
    <div className="space-y-6">
      {/* BARRA DE HERRAMIENTAS: BUSCADOR & GUÍA DE TALLAS */}
      <div className="space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Campo de Búsqueda Integrado con la Identidad del Comercio */}
          <div className="relative flex-1 max-w-md">
            <Search
              className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none transition-colors duration-200"
              style={{ color: searchQuery ? primaryColor : 'currentColor' }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                isServices
                  ? 'Buscar servicios o tratamientos...'
                  : isRestaurant
                  ? 'Buscar en la carta o menú...'
                  : isFashion
                  ? 'Buscar prendas o catálogo...'
                  : 'Buscar productos en el catálogo...'
              }
              className="w-full pl-10 pr-10 py-2.5 rounded-2xl bg-white dark:bg-stone-900/90 border border-stone-200/90 dark:border-stone-800 text-sm text-stone-900 dark:text-white placeholder:text-stone-400 dark:placeholder:text-stone-500 shadow-2xs transition-all duration-200 focus:outline-hidden focus:ring-2 focus:ring-offset-0"
              style={{
                borderColor: searchQuery ? primaryColor : undefined,
              }}
            />
            <AnimatePresence>
              {searchQuery && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.15 }}
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 transition active:scale-90 cursor-pointer"
                  title="Limpiar búsqueda"
                >
                  <X className="w-3.5 h-3.5" />
                </motion.button>
              )}
            </AnimatePresence>
          </div>

          {/* Botón Guía de Tallas (Específico de Moda) */}
          {isFashion && onOpenSizeGuide && (
            <button
              type="button"
              onClick={onOpenSizeGuide}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl bg-white dark:bg-stone-900/90 hover:bg-stone-50 dark:hover:bg-stone-800 border border-stone-200/90 dark:border-stone-800 text-stone-800 dark:text-stone-200 text-xs font-semibold shadow-2xs transition cursor-pointer self-start sm:self-auto hover:scale-[1.01] active:scale-[0.98]"
            >
              <Ruler className="w-3.5 h-3.5" style={{ color: primaryColor }} />
              <span>Guía de Tallas & Medidas</span>
            </button>
          )}
        </div>

        {/* SELECTOR DE CATEGORÍAS: SEGMENTADO CON IDENTIDAD DE MARCA */}
        {activeCategories.length > 0 && (
          <div className="relative">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-0.5 no-scrollbar scroll-smooth">
              {/* Pestaña "Todos" */}
              <button
                type="button"
                onClick={() => setSelectedCategoryId('all')}
                className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all duration-200 flex items-center gap-2 cursor-pointer shrink-0 select-none ${
                  selectedCategoryId === 'all'
                    ? 'shadow-xs font-bold active:scale-95'
                    : 'bg-white/80 dark:bg-stone-900/80 hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-600 dark:text-stone-300 border border-stone-200/80 dark:border-stone-800 hover:scale-[1.01] active:scale-95'
                }`}
                style={getActiveTabStyle(selectedCategoryId === 'all')}
              >
                <span>Todos</span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-md font-bold leading-none ${
                    selectedCategoryId === 'all'
                      ? 'bg-black/15 dark:bg-white/20'
                      : 'bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400'
                  }`}
                >
                  {publicProducts.length}
                </span>
              </button>

              {/* Pestañas de Categorías Reales */}
              {activeCategories.map((cat) => {
                const count = publicProducts.filter((p) => p.category_id === cat.id).length;
                const isSelected = selectedCategoryId === cat.id;

                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategoryId(cat.id)}
                    className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all duration-200 flex items-center gap-2 cursor-pointer shrink-0 select-none ${
                      isSelected
                        ? 'shadow-xs font-bold active:scale-95'
                        : 'bg-white/80 dark:bg-stone-900/80 hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-600 dark:text-stone-300 border border-stone-200/80 dark:border-stone-800 hover:scale-[1.01] active:scale-95'
                    }`}
                    style={getActiveTabStyle(isSelected)}
                  >
                    <span>{cat.name}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-md font-bold leading-none ${
                        isSelected
                          ? 'bg-black/15 dark:bg-white/20'
                          : 'bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ESTADO VACÍO CUANDO NO HAY COINCIDENCIAS */}
      {filteredProducts.length === 0 ? (
        <div className="py-16 text-center space-y-3 rounded-3xl border border-stone-200/80 dark:border-stone-800/80 bg-white/60 dark:bg-stone-900/60 backdrop-blur-xs p-6">
          <div
            className="w-12 h-12 mx-auto rounded-2xl flex items-center justify-center shadow-2xs"
            style={{ backgroundColor: `${primaryColor}14`, color: primaryColor }}
          >
            <ShoppingBag className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-stone-900 dark:text-white">
              No se encontraron productos disponibles
            </h3>
            <p className="text-xs text-stone-500 dark:text-stone-400 max-w-md mx-auto">
              {searchQuery
                ? `No encontramos resultados que coincidan con "${searchQuery}". Intenta con otra palabra o revisa otra categoría.`
                : 'No hay productos activos listados en esta categoría actualmente.'}
            </p>
          </div>
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="mt-2 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer inline-flex items-center gap-1.5 active:scale-98"
              style={{ backgroundColor: `${primaryColor}14`, color: primaryColor }}
            >
              <span>Restablecer búsqueda</span>
            </button>
          )}
        </div>
      ) : (
        /* REJILLA / LISTADO DE PRODUCTOS Y SERVICIOS */
        <>
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className={
            isListLayout
              ? 'flex flex-col gap-3.5'
              : isSpecialTemplate
              ? templateVisuals.catalogGrid
              : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6'
          }
        >
          {visibleProducts.map((product) => {
            const previousPrice = product.attributes?.previous_price as number | undefined;
            const hasOffer = previousPrice != null && previousPrice > product.price;
            const discountPercent = hasOffer
              ? Math.round(((previousPrice - product.price) / previousPrice) * 100)
              : 0;
            const isFeatured = Boolean(product.attributes?.is_featured);
            const hasBrokenImage = !product.image_url || imgErrors[product.id];
            const categoryName = product.category_id ? categoryMap.get(product.category_id) : undefined;

            // Atributos de Moda (solo si existen de verdad)
            const sizes = (product.attributes?.sizes as string[]) || [];
            const colors = (product.attributes?.colors as Array<{ name: string; hex: string }>) || [];

            // Atributos de Gastronomía
            const isCombo = Boolean(product.attributes?.is_combo);
            const modifiers = (product.attributes?.modifiers as Array<{ name: string; price: number }>) || [];

            // Atributos de Servicios
            const isService = isServices || Boolean(product.attributes?.is_service);
            const duration =
              typeof product.attributes?.duration_minutes === 'number' &&
              product.attributes.duration_minutes > 0
                ? product.attributes.duration_minutes
                : null;
            const specialty = (product.attributes?.specialty as string) || '';
            const professionalName = (product.attributes?.professional_name as string) || '';

            // Proporción visual de la fotografía adaptada armónicamente a la vertical o al modelo especial
            const imageAspectClass = (() => {
              if (isSpecialTemplate) {
                if (templateId === 'g2' || templateId === 'c2' || templateId === 'b1' || templateId === 'g8') return 'aspect-[16/9]';
                if (templateId === 'm2' || templateId === 'm1' || templateId === 'm3') return 'aspect-[3/4]';
                if (templateId === 'c1' || templateId === 'c3' || templateId === 'c4') return 'aspect-[1/1]';
                if (templateId === 'g1' || templateId === 'g5' || templateId === 'g6' || templateId === 'g7' || templateId === 'm4' || templateId === 'b2' || templateId === 'b3' || templateId === 'b4' || templateId === 's2' || templateId === 'g3') return 'aspect-[4/3]';
                if (templateId === 's1' || templateId === 's4' || templateId === 's3') return 'aspect-[16/10]';
              }
              return isFashion
                ? 'aspect-[3/4]'
                : isRestaurant || isServices
                ? 'aspect-[16/10]'
                : 'aspect-[4/3]';
            })();

            return (
              <motion.div
                key={product.id}
                id={`prod-${product.id}`}
                variants={itemVariants}
                onClick={() => onSelectProduct(product)}
                className={`group ${
                  isSpecialTemplate
                    ? `${templateVisuals.cardWrapper} ${templateVisuals.densityClass}`
                    : 'rounded-2xl sm:rounded-3xl bg-white dark:bg-stone-900 border border-stone-200/80 dark:border-stone-800/80 hover:border-stone-300 dark:hover:border-stone-700 p-3.5 sm:p-4'
                } transition-all duration-300 ${motionProfile.cardElevationClass} hover:shadow-md active:scale-[0.985] cursor-pointer relative overflow-hidden flex ${
                  isListLayout ? 'flex-col sm:flex-row gap-4' : 'flex-col justify-between'
                }`}
                style={
                  isFeatured
                    ? {
                        borderColor: `${primaryColor}55`,
                      }
                    : undefined
                }
              >
                {/* ZONA DE CONTENIDO SUPERIOR / IMAGEN */}
                <div className={isListLayout ? 'w-full sm:w-48 sm:h-36 shrink-0' : 'w-full'}>
                  {/* Contenedor Fotográfico con Proporción Óptima */}
                  <div
                    className={`relative w-full ${
                      isListLayout ? 'h-40 sm:h-full' : imageAspectClass
                    } rounded-xl sm:rounded-2xl overflow-hidden bg-stone-100 dark:bg-stone-800/80 border border-stone-200/60 dark:border-stone-800/60 mb-3 select-none`}
                  >
                    {hasBrokenImage ? (
                      /* Fallback Visual Neutro y Elegante */
                      <div
                        className="w-full h-full flex flex-col items-center justify-center gap-2 p-4 text-center transition-colors"
                        style={{ backgroundColor: `${primaryColor}0a` }}
                      >
                        <div
                          className="w-11 h-11 rounded-2xl flex items-center justify-center shadow-2xs"
                          style={{ backgroundColor: `${primaryColor}18`, color: primaryColor }}
                        >
                          {isRestaurant ? (
                            <Utensils className="w-5 h-5" />
                          ) : isFashion ? (
                            <Shirt className="w-5 h-5" />
                          ) : isServices ? (
                            <Briefcase className="w-5 h-5" />
                          ) : (
                            <StoreIcon className="w-5 h-5" />
                          )}
                        </div>
                        <span className="text-[11px] font-semibold text-stone-600 dark:text-stone-300 line-clamp-1 max-w-[85%]">
                          {categoryName || (isRestaurant ? 'Gastronomía' : isFashion ? 'Moda' : isServices ? 'Servicio' : 'Producto')}
                        </span>
                      </div>
                    ) : (
                      <img
                        src={product.image_url!}
                        alt={product.name}
                        onError={() => setImgErrors((prev) => ({ ...prev, [product.id]: true }))}
                        className={`w-full h-full object-cover transition-transform duration-500 ease-out ${imageHoverClass}`}
                        loading="lazy"
                        decoding="async"
                      />
                    )}

                    {/* Insignia: Producto Destacado */}
                    {isFeatured && (
                      <span
                        className="top-2.5 left-2.5 absolute px-2.5 py-1 rounded-lg text-white font-bold text-[10px] uppercase tracking-wider backdrop-blur-md flex items-center gap-1 shadow-xs"
                        style={{ backgroundColor: `${primaryColor}ee` }}
                      >
                        <Star className="w-3 h-3 fill-current" />
                        <span>Destacado</span>
                      </span>
                    )}

                    {/* Insignia: Oferta con Porcentaje Real */}
                    {hasOffer && (
                      <span className="top-2.5 right-11 absolute px-2 py-0.5 rounded-lg bg-rose-600 text-white font-bold text-[10px] shadow-xs tracking-wide">
                        {discountPercent > 0 ? `-${discountPercent}%` : 'Oferta'}
                      </span>
                    )}

                    {/* Estado: Agotado / No disponible */}
                    {!product.is_available && (
                      <div className="absolute inset-0 bg-stone-950/65 backdrop-blur-[2px] flex items-center justify-center p-2">
                        <span className="px-3 py-1 rounded-full bg-stone-900/95 text-stone-200 border border-stone-700 font-semibold text-xs shadow-lg flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />
                          <span>Agotado</span>
                        </span>
                      </div>
                    )}

                    {/* Botón Discreto para Compartir Producto */}
                    <button
                      type="button"
                      onClick={(e) => handleShareProduct(e, product.id, product.name)}
                      className="top-2.5 right-2.5 absolute w-7 h-7 rounded-full bg-black/50 hover:bg-black/80 text-white backdrop-blur-md flex items-center justify-center text-xs transition-all duration-200 hover:scale-110 active:scale-90 shadow-xs cursor-pointer opacity-90 group-hover:opacity-100"
                      title="Compartir enlace directo de este producto"
                    >
                      {copiedProductId === product.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Share2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                {/* ZONA DE INFORMACIÓN: NOMBRE, DESCRIPCIÓN Y ATRIBUTOS REALES */}
                <div className="flex-1 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    {/* Etiqueta de Categoría o Especialidad Real */}
                    {(categoryName || specialty) && (
                      <span
                        className={
                          isSpecialTemplate
                            ? `${templateVisuals.badgeClass} block truncate max-w-fit mb-1`
                            : 'text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500 block truncate'
                        }
                      >
                        {specialty || categoryName}
                      </span>
                    )}

                    {/* Nombre del Producto */}
                    <h3
                      className={`leading-snug line-clamp-1 group-hover:text-stone-950 dark:group-hover:text-white transition-colors ${
                        isSpecialTemplate
                          ? `${templateVisuals.typographyHeading} text-stone-900 dark:text-stone-100`
                          : 'text-base font-bold text-stone-900 dark:text-stone-100'
                      }`}
                    >
                      {product.name}
                    </h3>

                    {/* Descripción Real */}
                    {product.description && (
                      <p
                        className={`line-clamp-2 leading-relaxed ${
                          isSpecialTemplate
                            ? templateVisuals.typographyBody
                            : 'text-xs text-stone-500 dark:text-stone-400'
                        }`}
                      >
                        {product.description}
                      </p>
                    )}

                    {/* Atributos Reales de Vertical */}
                    {/* MODA: Tallas y Muestras de Color */}
                    {isFashion && (sizes.length > 0 || colors.length > 0) && (
                      <div className="pt-1 flex flex-wrap items-center gap-2 text-[10px]">
                        {sizes.length > 0 && (
                          <div className="flex items-center gap-1 flex-wrap">
                            <span className="font-semibold text-stone-400">Tallas:</span>
                            {sizes.map((s) => (
                              <span
                                key={s}
                                className="px-1.5 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 font-mono font-medium border border-stone-200/80 dark:border-stone-700/60"
                              >
                                {s}
                              </span>
                            ))}
                          </div>
                        )}
                        {colors.length > 0 && (
                          <div className="flex items-center gap-1 ml-auto">
                            {colors.slice(0, 5).map((c, idx) => (
                              <span
                                key={idx}
                                title={c.name}
                                className="w-3 h-3 rounded-full border border-stone-300 dark:border-stone-600 inline-block shadow-2xs"
                                style={{ backgroundColor: c.hex }}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* GASTRONOMÍA: Extras y Combo Especial */}
                    {isRestaurant && (modifiers.length > 0 || isCombo) && (
                      <div className="pt-1 flex flex-wrap items-center gap-1.5">
                        {modifiers.length > 0 && (
                          <span
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-md border"
                            style={{
                              backgroundColor: `${primaryColor}10`,
                              color: primaryColor,
                              borderColor: `${primaryColor}25`,
                            }}
                          >
                            {modifiers.length} extras disponibles
                          </span>
                        )}
                        {isCombo && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/25">
                            Combo Especial
                          </span>
                        )}
                      </div>
                    )}

                    {/* SERVICIOS: Duración y Profesional Asignado */}
                    {isService && (duration !== null || professionalName) && (
                      <div className="pt-1 flex flex-wrap items-center gap-2.5 text-[11px] text-stone-600 dark:text-stone-300">
                        {duration !== null && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-stone-100 dark:bg-stone-800/80 border border-stone-200/80 dark:border-stone-700/60 font-medium">
                            <Clock className="w-3 h-3 text-stone-400" />
                            <span>{duration} min</span>
                          </span>
                        )}
                        {professionalName && (
                          <span className="inline-flex items-center gap-1 text-stone-500 dark:text-stone-400 truncate max-w-[140px]">
                            <User className="w-3 h-3 text-stone-400 shrink-0" />
                            <span className="truncate">{professionalName}</span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* PIE DE TARJETA: PRECIO COMERCIAL & ACCIÓN PRINCIPAL */}
                  <div className="pt-3 mt-3.5 border-t border-stone-200/80 dark:border-stone-800/80 flex items-center justify-between gap-3">
                    {/* Presentación del Precio en Bolivianos (Bs) */}
                    <div className="flex items-baseline gap-1.5 min-w-0">
                      <span className="text-xs text-stone-500 dark:text-stone-400 font-semibold select-none">
                        Bs
                      </span>
                      <span className="text-lg sm:text-xl font-black text-stone-950 dark:text-white tracking-tight tabular-nums">
                        {product.price.toLocaleString('es-BO', {
                          minimumFractionDigits: product.price % 1 === 0 ? 0 : 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                      {hasOffer && previousPrice && (
                        <span className="text-xs text-stone-400 dark:text-stone-500 line-through select-none ml-0.5">
                          Bs {previousPrice.toLocaleString('es-BO')}
                        </span>
                      )}
                    </div>

                    {/* Botón de Acción con Identidad Visual del Comercio */}
                    {isService && onRequestAppointment ? (
                      <button
                        type="button"
                        disabled={!product.is_available}
                        onClick={(e) => {
                          if (!product.is_available) return;
                          e.stopPropagation();
                          onRequestAppointment(product.id);
                        }}
                        className={`min-h-[40px] px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all duration-200 shadow-2xs cursor-pointer ${
                          !product.is_available
                            ? 'bg-stone-100 dark:bg-stone-800 text-stone-400 dark:text-stone-500 cursor-not-allowed border border-stone-200 dark:border-stone-700/60 select-none'
                            : 'active:scale-95 hover:brightness-105 hover:shadow-xs'
                        }`}
                        style={getButtonVisuals(product.is_available)}
                      >
                        <Calendar className="w-3.5 h-3.5 transition-transform duration-200 group-hover:scale-105" />
                        <span>Agendar Cita</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={!product.is_available}
                        onClick={(e) => {
                          if (!product.is_available) return;
                          e.stopPropagation();
                          if (
                            (isFashion && (sizes.length > 0 || colors.length > 0)) ||
                            (isRestaurant && modifiers.length > 0)
                          ) {
                            onSelectProduct(product);
                          } else {
                            onQuickAddToCart(product);
                          }
                        }}
                        className={`min-h-[40px] px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all duration-200 shadow-2xs cursor-pointer ${
                          !product.is_available
                            ? 'bg-stone-100 dark:bg-stone-800 text-stone-400 dark:text-stone-500 cursor-not-allowed border border-stone-200 dark:border-stone-700/60 select-none'
                            : 'active:scale-95 hover:brightness-105 hover:shadow-xs'
                        }`}
                        style={getButtonVisuals(product.is_available)}
                      >
                        {!product.is_available ? (
                          <span>Agotado</span>
                        ) : isFashion && (sizes.length > 0 || colors.length > 0) ? (
                          <>
                            <ShoppingBag className="w-3.5 h-3.5" />
                            <span>Elegir</span>
                          </>
                        ) : isRestaurant && modifiers.length > 0 ? (
                          <>
                            <ShoppingBag className="w-3.5 h-3.5" />
                            <span>Elegir</span>
                          </>
                        ) : isService ? (
                          <>
                            <Plus className="w-3.5 h-3.5" />
                            <span>Reservar</span>
                          </>
                        ) : (
                          <>
                            <Plus className="w-3.5 h-3.5" />
                            <span>Agregar</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
        {visibleCount < filteredProducts.length && (
          <div className="flex justify-center pt-5">
            <button
              type="button"
              onClick={() => setVisibleCount((count) => count + 24)}
              className="px-5 py-3 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-sm font-semibold text-stone-800 dark:text-stone-100 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors"
            >
              Mostrar más ({filteredProducts.length - visibleCount} restantes)
            </button>
          </div>
        )}
        </>
      )}
    </div>
  );
};
