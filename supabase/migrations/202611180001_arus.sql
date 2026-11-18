create table public.ledgers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  state jsonb not null check (
    jsonb_typeof(state) = 'object'
    and state ?& array['accounts', 'groups', 'transactions']
    and jsonb_typeof(state->'accounts') = 'array'
    and jsonb_typeof(state->'groups') = 'array'
    and jsonb_typeof(state->'transactions') = 'array'
  )
);
alter table public.ledgers enable row level security;
revoke all on public.ledgers from anon, authenticated;
grant select, insert, update on public.ledgers to authenticated;
grant all on public.ledgers to service_role;
create policy "Read own ledger" on public.ledgers for select to authenticated using (auth.uid() = user_id);
create policy "Insert own ledger" on public.ledgers for insert to authenticated with check (auth.uid() = user_id);
create policy "Update own ledger" on public.ledgers for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.telegram_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null
);
create table public.telegram_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  chat_id text not null unique
);
create table public.telegram_drafts (
  chat_id text references public.telegram_links(chat_id) on delete cascade,
  update_id text,
  transaction_data jsonb not null,
  expires_at timestamptz not null default now() + interval '15 minutes',
  primary key (chat_id, update_id)
);
alter table public.telegram_codes enable row level security;
alter table public.telegram_links enable row level security;
alter table public.telegram_drafts enable row level security;
revoke all on public.telegram_codes, public.telegram_links, public.telegram_drafts from anon, authenticated;
grant all on public.telegram_codes, public.telegram_links, public.telegram_drafts to service_role;

create function public.arus_link_telegram(input_hash text, input_chat text)
returns boolean language plpgsql set search_path = '' as $$
declare owner_id uuid;
begin
  delete from public.telegram_codes
    where code_hash = input_hash and expires_at > now()
    returning user_id into owner_id;
  if owner_id is null then return false; end if;
  begin
    delete from public.telegram_links where user_id = owner_id;
    insert into public.telegram_links(user_id, chat_id) values (owner_id, input_chat);
  exception when unique_violation then
    return false;
  end;
  return true;
end;
$$;

create function public.arus_unlink_telegram(input_user uuid)
returns void language plpgsql set search_path = '' as $$
begin
  delete from public.telegram_codes where user_id = input_user;
  delete from public.telegram_links where user_id = input_user;
end;
$$;

create function public.arus_confirm_telegram(input_chat text, input_update text, should_save boolean)
returns text language plpgsql set search_path = '' as $$
declare
  owner_id uuid;
  draft jsonb;
  ledger_state jsonb;
begin
  select user_id into owner_id from public.telegram_links where chat_id = input_chat for update;
  if owner_id is null then return 'unlinked'; end if;
  delete from public.telegram_drafts where chat_id = input_chat and update_id = input_update and expires_at > now()
    returning transaction_data into draft;
  if not should_save then return 'cancelled'; end if;
  select state into ledger_state from public.ledgers where user_id = owner_id for update;
  if ledger_state->'transactions' @> jsonb_build_array(jsonb_build_object('id', 'telegram-' || input_update)) then
    return 'saved';
  end if;
  if draft is null then return 'expired'; end if;
  if ledger_state is null
    or not exists (
      select 1 from jsonb_array_elements(ledger_state->'accounts') as account
      where account->>'id' = draft->>'account'
    )
    or not exists (
      select 1 from jsonb_array_elements(ledger_state->'groups') as groups
      cross join lateral jsonb_array_elements(groups->'categories') as category
      where category->>'id' = draft->>'category'
        and coalesce(groups->>'archived', 'false') <> 'true'
        and coalesce(category->>'archived', 'false') <> 'true'
    ) then return 'invalid'; end if;
  update public.ledgers
    set revision = revision + 1, state = jsonb_set(state, '{transactions}', (state->'transactions') || jsonb_build_array(draft))
    where user_id = owner_id;
  return 'saved';
end;
$$;

revoke execute on function public.arus_link_telegram(text, text), public.arus_unlink_telegram(uuid),
  public.arus_confirm_telegram(text, text, boolean) from public, anon, authenticated;
grant execute on function public.arus_link_telegram(text, text), public.arus_unlink_telegram(uuid),
  public.arus_confirm_telegram(text, text, boolean) to service_role;
