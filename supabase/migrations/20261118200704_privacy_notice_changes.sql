-- What changed in the published Privacy Notice version, shown to everyone asked to acknowledge it.
alter table public.system_settings add column if not exists privacy_policy_changes text;
alter table public.system_settings drop constraint if exists system_settings_privacy_policy_changes_length;
alter table public.system_settings add constraint system_settings_privacy_policy_changes_length check (privacy_policy_changes is null or char_length(privacy_policy_changes)<=2000);
