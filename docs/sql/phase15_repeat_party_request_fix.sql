alter table public.party_membership_requests drop constraint party_membership_requests_party_id_character_id_request_typ_key;
-- Partial unique index party_membership_one_pending remains as the only pending-request uniqueness gate.
