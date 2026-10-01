\set ON_ERROR_STOP on

DROP TABLE IF EXISTS seats;

CREATE TABLE seats (
  seat_code text PRIMARY KEY,
  reserved_by text
);

INSERT INTO seats (seat_code, reserved_by)
VALUES ('A1', NULL);

SELECT seat_code, reserved_by
FROM seats;
