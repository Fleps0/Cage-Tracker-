-- Cage Tracker: Tabellen für die gemeinsame X-Watchlist, die erkannten Posts und die Push-Abos.
-- Einmalig im Supabase-Dashboard unter "SQL Editor" ausführen (siehe SETUP.md, Schritt 5).

-- pgcrypto liefert gen_random_uuid() -- in Supabase-Projekten normalerweise schon aktiv,
-- diese Zeile ist nur eine Absicherung, falls nicht.
create extension if not exists pgcrypto;

-- Die gemeinsame Watchlist: ein Eintrag pro beobachtetem X-Profil, für den ganzen Discord sichtbar.
create table if not exists public.watchlist (
  id uuid primary key default gen_random_uuid(),
  handle text not null unique,
  display_name text,
  added_by uuid references auth.users (id) on delete set null,
  added_by_name text,
  last_seen_post_id text,
  created_at timestamptz not null default now()
);

-- Row Level Security: alle eingeloggten Mitglieder sehen die ganze Watchlist,
-- aber jeder darf nur eigene Einträge hinzufügen bzw. wieder entfernen.
alter table public.watchlist enable row level security;

drop policy if exists "watchlist_select_all_authenticated" on public.watchlist;
create policy "watchlist_select_all_authenticated"
  on public.watchlist for select
  using (auth.role() = 'authenticated');

drop policy if exists "watchlist_insert_own" on public.watchlist;
create policy "watchlist_insert_own"
  on public.watchlist for insert
  with check (auth.uid() = added_by);

drop policy if exists "watchlist_delete_own" on public.watchlist;
create policy "watchlist_delete_own"
  on public.watchlist for delete
  using (auth.uid() = added_by);

-- Die erkannten Posts: wird ausschließlich von der Edge Function befüllt (per
-- service_role-Key, der Row Level Security umgeht) -- deshalb bewusst KEINE
-- Insert/Update-Policy für normale Nutzer. Alle eingeloggten Mitglieder dürfen
-- den Feed nur lesen.
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null references public.watchlist (id) on delete cascade,
  handle text not null,
  post_id text not null,
  post_url text not null,
  text_preview text,
  posted_at timestamptz,
  detected_at timestamptz not null default now(),
  unique (handle, post_id)
);

alter table public.posts enable row level security;

drop policy if exists "posts_select_all_authenticated" on public.posts;
create policy "posts_select_all_authenticated"
  on public.posts for select
  using (auth.role() = 'authenticated');

-- Realtime aktivieren, damit die Seite neue Posts live bekommt, ohne neu zu laden.
alter publication supabase_realtime add table public.posts;

-- Browser-Push-Abos: ein Eintrag pro Gerät/Browser, das sich für Benachrichtigungen
-- angemeldet hat. Wird nur von der Seite selbst geschrieben (eigenes Abo) und nur von
-- der Edge Function gelesen (per service_role) -- deshalb keine Select-Policy für
-- normale Nutzer nötig.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_insert_own" on public.push_subscriptions;
create policy "push_subscriptions_insert_own"
  on public.push_subscriptions for insert
  with check (auth.uid() = user_id);

drop policy if exists "push_subscriptions_delete_own" on public.push_subscriptions;
create policy "push_subscriptions_delete_own"
  on public.push_subscriptions for delete
  using (auth.uid() = user_id);
