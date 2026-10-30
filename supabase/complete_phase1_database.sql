-- ============================================================================
-- FASE 1: BASE DE DATOS Y SEGURIDAD — SAAS MARKETPLACE VERTICALIZADO
-- ARCHIVO COMPLETO CONSOLIDADO PARA SUPABASE / POSTGRESQL
-- Incluye: Esquema, Índices, Funciones de Seguridad, RLS y Storage Buckets
-- ============================================================================

-- 1. EXTENSIONES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. TIPOS ENUMERADOS
DO $$ BEGIN
    CREATE TYPE store_type AS ENUM ('general', 'restaurante', 'moda', 'servicios');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE store_status AS ENUM ('activo', 'inactivo', 'suspendido', 'prueba');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE store_user_role AS ENUM ('admin', 'staff', 'superadmin');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE category_status AS ENUM ('activo', 'inactivo');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE product_status AS ENUM ('activo', 'inactivo', 'borrador');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE order_status AS ENUM (
        'pendiente', 'recibido', 'pagado', 'en_preparacion',
        'despachado', 'completado', 'cancelado'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3. TRIGGER AUTOMÁTICO PARA updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. TABLAS PRINCIPALES

-- 4.1 Comercios
CREATE TABLE IF NOT EXISTS stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE,
    store_type store_type NOT NULL DEFAULT 'general',
    status store_status NOT NULL DEFAULT 'prueba',
    logo_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_stores_updated_at
    BEFORE UPDATE ON stores
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4.2 Usuarios del Comercio (Multi-Tenant)
CREATE TABLE IF NOT EXISTS store_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    user_id UUID NOT NULL, -- Compatible con Supabase auth.users(id)
    role store_user_role NOT NULL DEFAULT 'admin',
    full_name VARCHAR(255),
    email VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_user UNIQUE(tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_store_users_tenant ON store_users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_store_users_user ON store_users(user_id);
CREATE INDEX IF NOT EXISTS idx_store_users_role ON store_users(tenant_id, role);

CREATE TRIGGER trg_store_users_updated_at
    BEFORE UPDATE ON store_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4.3 Categorías
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    status category_status NOT NULL DEFAULT 'activo',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_categories_tenant ON categories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_categories_tenant_status ON categories(tenant_id, status);

CREATE TRIGGER trg_categories_updated_at
    BEFORE UPDATE ON categories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4.4 Productos (con campo attributes JSONB para particularidades por vertical)
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    image_url TEXT,
    status product_status NOT NULL DEFAULT 'activo',
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id);
CREATE INDEX IF NOT EXISTS idx_products_tenant_status ON products(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_products_tenant_category ON products(tenant_id, category_id);
CREATE INDEX IF NOT EXISTS idx_products_attributes ON products USING gin(attributes);

CREATE TRIGGER trg_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4.5 Pedidos
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    customer_id UUID,
    customer_name VARCHAR(255),
    customer_email VARCHAR(255),
    customer_phone VARCHAR(50),
    status order_status NOT NULL DEFAULT 'pendiente',
    total NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (total >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_tenant ON orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_status ON orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_created ON orders(tenant_id, created_at DESC);

CREATE TRIGGER trg_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4.6 Detalle de Pedidos
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_tenant ON order_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);

-- 5. FUNCIONES DE SEGURIDAD (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION get_user_tenant_ids()
RETURNS TABLE (tenant_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT su.tenant_id
    FROM store_users su
    WHERE su.user_id = auth.uid()
      AND su.is_active = TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
STABLE
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM public.store_users su
        WHERE su.user_id = auth.uid()
          AND su.role = 'superadmin'
          AND su.is_active = TRUE
    );
END;
$$;

CREATE OR REPLACE FUNCTION is_tenant_admin(check_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    RETURN (
        is_superadmin()
        OR EXISTS (
            SELECT 1
            FROM store_users su
            WHERE su.tenant_id = check_tenant_id
              AND su.user_id = auth.uid()
              AND su.role IN ('admin', 'superadmin')
              AND su.is_active = TRUE
        )
    );
END;
$$;

-- 6. ROW LEVEL SECURITY (RLS)
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- 6.1 Políticas: Stores
CREATE POLICY "stores_public_read" ON stores FOR SELECT TO anon, authenticated
    USING (status IN ('activo', 'prueba'));

CREATE POLICY "stores_tenant_select" ON stores FOR SELECT TO authenticated
    USING (id IN (SELECT get_user_tenant_ids()) OR is_superadmin());

CREATE POLICY "stores_tenant_update" ON stores FOR UPDATE TO authenticated
    USING (id IN (SELECT get_user_tenant_ids()) OR is_superadmin())
    WITH CHECK (id IN (SELECT get_user_tenant_ids()) OR is_superadmin());

CREATE POLICY "stores_superadmin_insert" ON stores FOR INSERT TO authenticated
    WITH CHECK (public.is_superadmin());

CREATE POLICY "stores_superadmin_delete" ON stores FOR DELETE TO authenticated
    USING (is_superadmin());

-- 6.2 Políticas: Store Users
CREATE POLICY "store_users_tenant_select" ON store_users FOR SELECT TO authenticated
    USING (tenant_id IN (SELECT get_user_tenant_ids()) OR is_superadmin());

-- Las escrituras de asociaciones se realizan exclusivamente desde endpoints
-- autorizados que usan service_role. RLS no concede escritura directa al cliente.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.store_users
    FROM PUBLIC, anon, authenticated;
REVOKE INSERT (id, tenant_id, user_id, role, full_name, email, is_active, created_at, updated_at),
       UPDATE (id, tenant_id, user_id, role, full_name, email, is_active, created_at, updated_at)
    ON TABLE public.store_users
    FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.store_users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.store_users TO service_role;

-- 6.3 Políticas: Categorías
CREATE POLICY "categories_public_read" ON categories FOR SELECT TO anon, authenticated
    USING (
        status = 'activo'
        AND EXISTS (
            SELECT 1 FROM stores s
            WHERE s.id = categories.tenant_id AND s.status IN ('activo', 'prueba')
        )
    );

CREATE POLICY "categories_tenant_select" ON categories FOR SELECT TO authenticated
    USING (tenant_id IN (SELECT get_user_tenant_ids()) OR is_superadmin());

CREATE POLICY "categories_tenant_insert" ON categories FOR INSERT TO authenticated
    WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()) OR is_superadmin());

CREATE POLICY "categories_tenant_update" ON categories FOR UPDATE TO authenticated
    USING (tenant_id IN (SELECT get_user_tenant_ids()) OR is_superadmin())
    WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()) OR is_superadmin());

CREATE POLICY "categories_tenant_delete" ON categories FOR DELETE TO authenticated
    USING (tenant_id IN (SELECT get_user_tenant_ids()) OR is_superadmin());

-- 6.4 Políticas: Productos
CREATE POLICY "products_public_read" ON products FOR SELECT TO anon, authenticated
    USING (
        status = 'activo' AND is_available = TRUE
        AND EXISTS (
            SELECT 1 FROM stores s
            WHERE s.id = products.tenant_id AND s.status IN ('activo', 'prueba')
        )
    );

CREATE POLICY "products_tenant_select" ON products FOR SELECT TO authenticated
    USING (tenant_id IN (SELECT get_user_tenant_ids()) OR is_superadmin());

CREATE POLICY "products_tenant_insert" ON products FOR INSERT TO authenticated
    WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()) OR is_superadmin());

CREATE POLICY "products_tenant_update" ON products FOR UPDATE TO authenticated
    USING (tenant_id IN (SELECT get_user_tenant_ids()) OR is_superadmin())
    WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()) OR is_superadmin());

CREATE POLICY "products_tenant_delete" ON products FOR DELETE TO authenticated
    USING (tenant_id IN (SELECT get_user_tenant_ids()) OR is_superadmin());

-- 6.5 Políticas: Pedidos
CREATE POLICY "orders_tenant_select" ON orders FOR SELECT TO authenticated
    USING (tenant_id IN (SELECT get_user_tenant_ids()) OR is_superadmin());

CREATE POLICY "orders_tenant_update" ON orders FOR UPDATE TO authenticated
    USING (tenant_id IN (SELECT get_user_tenant_ids()) OR is_superadmin())
    WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()) OR is_superadmin());

CREATE POLICY "orders_customer_select" ON orders FOR SELECT TO authenticated
    USING (customer_id = auth.uid());

-- La creación de pedidos se realiza mediante /api/checkout/create-order con
-- service_role; los clientes no insertan cabeceras directamente.
REVOKE INSERT ON TABLE public.orders FROM PUBLIC, anon, authenticated;
REVOKE INSERT (id, tenant_id, customer_id, customer_name, customer_email,
               customer_phone, status, total, created_at, updated_at)
    ON TABLE public.orders
    FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.orders TO service_role;

-- 6.6 Políticas: Detalle de Pedidos
CREATE POLICY "order_items_tenant_select" ON order_items FOR SELECT TO authenticated
    USING (tenant_id IN (SELECT get_user_tenant_ids()) OR is_superadmin());

CREATE POLICY "order_items_customer_select" ON order_items FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM orders o
            WHERE o.id = order_items.order_id AND o.customer_id = auth.uid()
        )
    );

-- Los artículos se crean junto con la cabecera desde el endpoint servidor.
REVOKE INSERT ON TABLE public.order_items FROM PUBLIC, anon, authenticated;
REVOKE INSERT (id, tenant_id, order_id, product_id, quantity, unit_price, created_at)
    ON TABLE public.order_items
    FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.order_items TO service_role;

-- 7. SUPABASE STORAGE BUCKETS Y POLÍTICAS
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
    ('store-logos', 'store-logos', TRUE, 2097152, ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']),
    ('product-images', 'product-images', TRUE, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp']),
    ('receipts', 'receipts', FALSE, 10485760, ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Políticas de Storage por Carpeta {tenant_id}/*
CREATE POLICY "store_logos_public_read" ON storage.objects FOR SELECT TO anon, authenticated
    USING (bucket_id = 'store-logos');

CREATE POLICY "store_logos_tenant_upload" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'store-logos' AND ((storage.foldername(name))[1]::uuid IN (SELECT get_user_tenant_ids()) OR is_superadmin()));

CREATE POLICY "product_images_public_read" ON storage.objects FOR SELECT TO anon, authenticated
    USING (bucket_id = 'product-images');

CREATE POLICY "product_images_tenant_upload" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'product-images' AND ((storage.foldername(name))[1]::uuid IN (SELECT get_user_tenant_ids()) OR is_superadmin()));

CREATE POLICY "receipts_tenant_read" ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'receipts' AND ((storage.foldername(name))[1]::uuid IN (SELECT get_user_tenant_ids()) OR is_superadmin()));

CREATE POLICY "receipts_upload" ON storage.objects FOR INSERT TO anon, authenticated
    WITH CHECK (bucket_id = 'receipts' AND ((storage.foldername(name))[1]::uuid IN (SELECT get_user_tenant_ids()) OR EXISTS (SELECT 1 FROM stores s WHERE s.id = (storage.foldername(name))[1]::uuid AND s.status IN ('activo', 'prueba'))));
