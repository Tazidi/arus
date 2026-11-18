create or replace function public.arus_confirm_telegram(input_chat text, input_update text, should_save boolean)
returns text language plpgsql set search_path = '' as $$
declare
  owner_id uuid;
  draft jsonb;
  ledger_state jsonb;
  transaction_type text;
begin
  select user_id into owner_id from public.telegram_links where chat_id = input_chat for update;
  if owner_id is null then return 'unlinked'; end if;

  delete from public.telegram_drafts
    where chat_id = input_chat and update_id = input_update and expires_at > now()
    returning transaction_data into draft;
  select state into ledger_state from public.ledgers where user_id = owner_id for update;

  if ledger_state->'transactions' @> jsonb_build_array(jsonb_build_object('id', 'telegram-' || input_update)) then
    return 'saved';
  end if;
  if not should_save then return 'cancelled'; end if;
  if draft is null then return 'expired'; end if;

  transaction_type := draft->>'type';
  if ledger_state is null or transaction_type is null or transaction_type not in ('income', 'expense', 'transfer')
    or not exists (
      select 1 from jsonb_array_elements(ledger_state->'accounts') as account
      where account->>'id' = draft->>'account'
    ) then
    return 'invalid';
  end if;

  if transaction_type = 'expense' and not exists (
    select 1 from jsonb_array_elements(ledger_state->'groups') as category_group
    cross join lateral jsonb_array_elements(category_group->'categories') as category
    where category->>'id' = draft->>'category'
      and coalesce(category_group->>'archived', 'false') <> 'true'
      and coalesce(category->>'archived', 'false') <> 'true'
  ) then
    return 'invalid';
  end if;

  if transaction_type = 'transfer' and (
    draft->>'to' = draft->>'account'
    or not exists (
      select 1 from jsonb_array_elements(ledger_state->'accounts') as destination
      where destination->>'id' = draft->>'to'
    )
  ) then
    return 'invalid';
  end if;

  update public.ledgers
    set revision = revision + 1,
        state = jsonb_set(state, '{transactions}', (state->'transactions') || jsonb_build_array(draft))
    where user_id = owner_id;
  return 'saved';
end;
$$;
