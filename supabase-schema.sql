-- Cage Tracker: Tabellen für persönliche Watchlists, die gemeinsam gepollten Handles,
-- den geteilten Feed und die Push-Abos.
-- Einmalig im Supabase-Dashboard unter "SQL Editor" ausführen (siehe SETUP.md, Schritt 5).
--
-- Hinweis für ein bereits laufendes Cage-Tracker-Projekt (Schema von vor dieser Version):
-- Dieses Skript baut NICHT automatisch bestehende Tabellen um -- dafür gibt es eine
-- separate Migration. Auf einem frischen Projekt (neue Installation) einfach komplett
-- ausführen.

-- pgcrypto liefert gen_random_uuid() -- in Supabase-Projekten normalerweise schon aktiv,
-- diese Zeile ist nur eine Absicherung, falls nicht.
create extension if not exists pgcrypto;

-- Global gepollte Handles: EIN Eintrag pro X-Profil, unabhängig davon, wie viele Nutzer
-- es auf ihrer persönlichen Watchlist haben -- verhindert doppelte (kostenpflichtige)
-- API-Abfragen für dasselbe Profil. Nur die Edge Function (service_role) und die Funktion
-- add_to_watchlist() unten greifen hier zu, deshalb keine Policies für normale Nutzer.
create table if not exists public.tracked_handles (
  id uuid primary key default gen_random_uuid(),
  handle text not null unique,
  last_seen_post_id text,
  -- ID, die twitterapi.io für die Echtzeit-Beobachtung dieses Profils vergibt (aus
  -- get_user_to_monitor_tweet) -- nötig, um das Profil später sauber wieder abzumelden.
  stream_monitor_id text,
  -- Profilbild-URL von X, einmalig abgefragt (siehe watchlist-Edge-Function) und dann
  -- wiederverwendet -- spart wiederholte, kostenpflichtige Abfragen.
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.tracked_handles enable row level security;

-- Persönliche Watchlist: wer verfolgt welches Profil. Jeder sieht und verwaltet nur seine
-- eigenen Zeilen -- komplett privat pro Nutzer.
create table if not exists public.watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  handle text not null,
  -- Kopie von tracked_handles.avatar_url, damit die eigene Watchlist-Ansicht das
  -- Profilbild zeigen kann, ohne dass normale Nutzer tracked_handles lesen dürfen.
  avatar_url text,
  created_at timestamptz not null default now(),
  unique (user_id, handle)
);

alter table public.watchlist enable row level security;

drop policy if exists "watchlist_select_own" on public.watchlist;
create policy "watchlist_select_own"
  on public.watchlist for select
  using (auth.uid() = user_id);

drop policy if exists "watchlist_delete_own" on public.watchlist;
create policy "watchlist_delete_own"
  on public.watchlist for delete
  using (auth.uid() = user_id);

-- Kein direktes Insert per Policy -- läuft ausschließlich über add_to_watchlist() unten,
-- damit gleichzeitig der globale tracked_handles-Eintrag entsteht.

-- Fügt ein Profil zur eigenen Watchlist hinzu und legt es bei Bedarf global zum Pollen an.
-- Gibt true zurück, wenn der Handle GLOBAL neu war (also gerade erst in tracked_handles
-- angelegt wurde) -- die watchlist-Edge-Function nutzt das, um zu wissen, ob sie das Profil
-- zusätzlich bei twitterapi.io für die Echtzeit-Beobachtung anmelden muss.
-- SECURITY DEFINER: läuft mit den Rechten der Funktion (Tabellenbesitzer), umgeht damit
-- gezielt die fehlende Insert-Policy auf tracked_handles -- das ist hier gewollt, nicht
-- eine Lücke, denn nur diese Funktion darf tracked_handles befüllen.
create or replace function public.add_to_watchlist(p_handle text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int;
begin
  insert into public.tracked_handles (handle) values (p_handle)
  on conflict (handle) do nothing;

  get diagnostics v_inserted = row_count;

  insert into public.watchlist (user_id, handle) values (auth.uid(), p_handle);

  return v_inserted > 0;
end;
$$;

grant execute on function public.add_to_watchlist(text) to authenticated;

-- Räumt einen global gepollten Handle auf, sobald ihn niemand mehr auf der eigenen
-- Watchlist hat -- inklusive der zugehörigen Posts (per on delete cascade unten).
create or replace function public.cleanup_tracked_handle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.watchlist where handle = old.handle) then
    delete from public.tracked_handles where handle = old.handle;
  end if;
  return old;
end;
$$;

drop trigger if exists watchlist_cleanup_after_delete on public.watchlist;
create trigger watchlist_cleanup_after_delete
  after delete on public.watchlist
  for each row execute function public.cleanup_tracked_handle();

-- Die erkannten Posts: EIN gemeinsamer Feed für alle -- unabhängig davon, wer welches
-- Profil auf der eigenen Watchlist hat. Wird ausschließlich von der Edge Function befüllt
-- (per service_role-Key, der Row Level Security umgeht) -- deshalb bewusst KEINE
-- Insert/Update-Policy für normale Nutzer. Alle eingeloggten Mitglieder dürfen nur lesen.
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  tracked_handle_id uuid not null references public.tracked_handles (id) on delete cascade,
  handle text not null,
  post_id text not null,
  post_url text not null,
  text_preview text,
  -- Kopie von tracked_handles.avatar_url zum Zeitpunkt des Fundes, damit der Feed das
  -- Profilbild zeigen kann, ohne tracked_handles lesen zu müssen.
  avatar_url text,
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
-- angemeldet hat. Bewusst weiterhin GLOBAL (nicht an die persönliche Watchlist gekoppelt) --
-- der Feed ist gemeinsam, also bekommt jedes aktivierte Gerät jede Benachrichtigung, egal
-- wer das jeweilige Profil eingetragen hat. Wird nur von der Seite selbst geschrieben
-- (eigenes Abo) und nur von der Edge Function gelesen (per service_role) -- deshalb keine
-- Select-Policy für normale Nutzer nötig.
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

-- Mitglieder-Zähler für die Seite ("X Mitglieder"): normale Nutzer dürfen auth.users nicht
-- direkt lesen, deshalb diese schlanke SECURITY-DEFINER-Funktion, die nur die Anzahl
-- zurückgibt -- keine Namen, keine E-Mails, keine sonstigen Nutzer-Daten.
create or replace function public.get_member_count()
returns bigint
language sql
security definer
set search_path = public
as $$
  select count(*) from auth.users;
$$;

grant execute on function public.get_member_count() to authenticated;
