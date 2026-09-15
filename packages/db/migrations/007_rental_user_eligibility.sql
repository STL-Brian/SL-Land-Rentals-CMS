-- Enforce rental-owner eligibility at the database boundary.
CREATE OR REPLACE FUNCTION enforce_rental_user_eligibility()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('PENDING','ACTIVE') AND NEW.ends_at > now() THEN
    PERFORM 1
    FROM users
    WHERE id = NEW.user_id
      AND active
      AND role IN ('RESIDENT','RENTER','ADMINISTRATOR')
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'RENTAL_USER_INELIGIBLE' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rentals_require_eligible_user ON rentals;
CREATE TRIGGER rentals_require_eligible_user
BEFORE INSERT OR UPDATE OF user_id,status,ends_at ON rentals
FOR EACH ROW EXECUTE FUNCTION enforce_rental_user_eligibility();

CREATE OR REPLACE FUNCTION prevent_ineligible_user_with_live_rental()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NOT NEW.active OR NEW.role NOT IN ('RESIDENT','RENTER','ADMINISTRATOR'))
     AND (OLD.active IS DISTINCT FROM NEW.active OR OLD.role IS DISTINCT FROM NEW.role) THEN
    PERFORM 1
    FROM rentals
    WHERE user_id = NEW.id
      AND status IN ('PENDING','ACTIVE')
      AND ends_at > now()
    FOR UPDATE;
    IF FOUND THEN
      RAISE EXCEPTION 'ACTIVE_RENTAL_ROLE_CONFLICT' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_preserve_live_rental_eligibility ON users;
CREATE TRIGGER users_preserve_live_rental_eligibility
BEFORE UPDATE OF active,role ON users
FOR EACH ROW EXECUTE FUNCTION prevent_ineligible_user_with_live_rental();
