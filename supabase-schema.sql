-- Birthday Wish database for Supabase (Postgres).
-- Run once in Supabase SQL Editor. Only RPC functions are exposed to browser clients.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.wishlists (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_name text not null check (pg_catalog.length(pg_catalog.btrim(owner_name)) between 1 and 80),
  title text not null check (pg_catalog.length(pg_catalog.btrim(title)) between 1 and 160),
  birthday date,
  created_at timestamptz not null default now()
);

create table if not exists public.wishlist_admin_secrets (
  wishlist_id uuid primary key references public.wishlists(id) on delete cascade,
  key_hash text not null
);

create table if not exists public.wishlist_items (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  wishlist_id uuid not null references public.wishlists(id) on delete cascade,
  name text not null check (pg_catalog.length(pg_catalog.btrim(name)) between 1 and 160),
  price numeric(12,2) not null check (price >= 0),
  purchase_url text,
  image_url text,
  note text,
  priority text,
  state text not null default 'open' check (state in ('open', 'taken', 'received')),
  claim_token_hash text,
  created_at timestamptz not null default now()
);

alter table public.wishlists enable row level security;
alter table public.wishlist_admin_secrets enable row level security;
alter table public.wishlist_items enable row level security;
revoke all on public.wishlists, public.wishlist_admin_secrets, public.wishlist_items from anon, authenticated;

create or replace function public.get_wishlist(p_wishlist_id uuid, p_claim_token text default null)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', w.id,
    'owner', w.owner_name,
    'title', w.title,
    'birthday', w.birthday,
    'items', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', i.id,
        'name', i.name,
        'price', i.price,
        'url', i.purchase_url,
        'image', i.image_url,
        'note', i.note,
        'priority', i.priority,
        'state', i.state,
        'mine', i.state = 'taken' and p_claim_token is not null and
          i.claim_token_hash = pg_catalog.encode(extensions.digest(p_claim_token, 'sha256'), 'hex')
      ) order by i.created_at, i.id)
      from public.wishlist_items i where i.wishlist_id = w.id
    ), '[]'::jsonb)
  )
  from public.wishlists w where w.id = p_wishlist_id;
$$;

create or replace function public.create_wishlist(p_owner_name text, p_title text, p_birthday date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := pg_catalog.gen_random_uuid();
  v_key text := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
begin
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_owner_name, ''))) not between 1 and 80 then raise exception '昵称长度需为 1–80 个字符'; end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_title, ''))) not between 1 and 160 then raise exception '标题长度需为 1–160 个字符'; end if;
  insert into public.wishlists(id, owner_name, title, birthday) values (v_id, pg_catalog.btrim(p_owner_name), pg_catalog.btrim(p_title), p_birthday);
  insert into public.wishlist_admin_secrets(wishlist_id, key_hash)
    values (v_id, pg_catalog.encode(extensions.digest(v_key, 'sha256'), 'hex'));
  return pg_catalog.jsonb_build_object('id', v_id, 'admin_key', v_key);
end;
$$;

create or replace function public.validate_admin_key(p_wishlist_id uuid, p_admin_key text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.wishlist_admin_secrets s
    where s.wishlist_id = p_wishlist_id
      and s.key_hash = pg_catalog.encode(extensions.digest(coalesce(p_admin_key, ''), 'sha256'), 'hex')
  );
$$;

create or replace function public.save_item(
  p_wishlist_id uuid, p_admin_key text, p_item_id uuid, p_name text, p_price numeric,
  p_purchase_url text, p_image_url text, p_note text, p_priority text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_item_id uuid;
begin
  if not public.validate_admin_key(p_wishlist_id, p_admin_key) then raise exception '管理口令无效'; end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_name, ''))) not between 1 and 160 then raise exception '礼物名称长度需为 1–160 个字符'; end if;
  if p_price is null or p_price < 0 then raise exception '预估金额不能小于 0'; end if;
  if p_item_id is null then
    insert into public.wishlist_items(wishlist_id, name, price, purchase_url, image_url, note, priority)
    values (p_wishlist_id, pg_catalog.btrim(p_name), p_price, p_purchase_url, p_image_url, p_note, p_priority)
    returning id into v_item_id;
  else
    update public.wishlist_items set name=pg_catalog.btrim(p_name), price=p_price, purchase_url=p_purchase_url,
      image_url=p_image_url, note=p_note, priority=p_priority
    where id=p_item_id and wishlist_id=p_wishlist_id returning id into v_item_id;
    if v_item_id is null then raise exception '找不到该心愿条目'; end if;
  end if;
  return v_item_id;
end;
$$;

create or replace function public.delete_item(p_wishlist_id uuid, p_admin_key text, p_item_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.validate_admin_key(p_wishlist_id, p_admin_key) then raise exception '管理口令无效'; end if;
  delete from public.wishlist_items where id=p_item_id and wishlist_id=p_wishlist_id;
  return found;
end;
$$;

create or replace function public.set_item_received(p_wishlist_id uuid, p_admin_key text, p_item_id uuid, p_received boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.validate_admin_key(p_wishlist_id, p_admin_key) then raise exception '管理口令无效'; end if;
  update public.wishlist_items set state=case when p_received then 'received' else 'open' end,
    claim_token_hash=case when p_received then claim_token_hash else null end
  where id=p_item_id and wishlist_id=p_wishlist_id;
  return found;
end;
$$;

create or replace function public.update_wishlist(p_wishlist_id uuid, p_admin_key text, p_title text, p_birthday date)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.validate_admin_key(p_wishlist_id, p_admin_key) then raise exception '管理口令无效'; end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_title, ''))) not between 1 and 160 then raise exception '标题长度需为 1–160 个字符'; end if;
  update public.wishlists set title=pg_catalog.btrim(p_title), birthday=p_birthday where id=p_wishlist_id;
  return found;
end;
$$;

create or replace function public.claim_item(p_item_id uuid, p_claim_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_catalog.length(coalesce(p_claim_token, '')) < 20 then raise exception '无效的匿名设备令牌'; end if;
  update public.wishlist_items set state='taken',
    claim_token_hash=pg_catalog.encode(extensions.digest(p_claim_token, 'sha256'), 'hex')
  where id=p_item_id and state='open';
  return found;
end;
$$;

create or replace function public.undo_claim(p_item_id uuid, p_claim_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.wishlist_items set state='open', claim_token_hash=null
  where id=p_item_id and state='taken'
    and claim_token_hash=pg_catalog.encode(extensions.digest(coalesce(p_claim_token, ''), 'sha256'), 'hex');
  return found;
end;
$$;

revoke all on function public.get_wishlist(uuid, text) from public;
revoke all on function public.create_wishlist(text, text, date) from public;
revoke all on function public.validate_admin_key(uuid, text) from public;
revoke all on function public.save_item(uuid, text, uuid, text, numeric, text, text, text, text) from public;
revoke all on function public.delete_item(uuid, text, uuid) from public;
revoke all on function public.set_item_received(uuid, text, uuid, boolean) from public;
revoke all on function public.update_wishlist(uuid, text, text, date) from public;
revoke all on function public.claim_item(uuid, text) from public;
revoke all on function public.undo_claim(uuid, text) from public;

grant execute on function public.get_wishlist(uuid, text) to anon, authenticated;
grant execute on function public.create_wishlist(text, text, date) to anon, authenticated;
grant execute on function public.validate_admin_key(uuid, text) to anon, authenticated;
grant execute on function public.save_item(uuid, text, uuid, text, numeric, text, text, text, text) to anon, authenticated;
grant execute on function public.delete_item(uuid, text, uuid) to anon, authenticated;
grant execute on function public.set_item_received(uuid, text, uuid, boolean) to anon, authenticated;
grant execute on function public.update_wishlist(uuid, text, text, date) to anon, authenticated;
grant execute on function public.claim_item(uuid, text) to anon, authenticated;
grant execute on function public.undo_claim(uuid, text) to anon, authenticated;
