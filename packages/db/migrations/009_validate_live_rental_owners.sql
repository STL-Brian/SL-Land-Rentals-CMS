-- Refuse an upgrade that would preserve an invalid live rental.
DO $$
DECLARE
  violation_count bigint;
BEGIN
  SELECT count(*) INTO violation_count
  FROM rentals r
  JOIN users u ON u.id = r.user_id
  WHERE r.status IN ('PENDING','ACTIVE')
    AND r.ends_at > now()
    AND (NOT u.active OR u.role NOT IN ('RESIDENT','RENTER','ADMINISTRATOR'));

  IF violation_count > 0 THEN
    RAISE EXCEPTION 'RENTAL_USER_INELIGIBLE: % pre-existing live rental(s) have inactive or ineligible owners', violation_count
      USING ERRCODE = '23514',
            HINT = 'Resolve or end the listed live rentals before retrying the migration.';
  END IF;
END;
$$;
