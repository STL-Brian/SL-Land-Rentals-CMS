-- Strengthen rental insertion versus role-update serialization.
CREATE OR REPLACE FUNCTION enforce_rental_user_eligibility()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('PENDING','ACTIVE') AND NEW.ends_at > now() THEN
    PERFORM 1
    FROM users
    WHERE id = NEW.user_id
      AND active
      AND role IN ('RESIDENT','RENTER','ADMINISTRATOR')
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'RENTAL_USER_INELIGIBLE' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
