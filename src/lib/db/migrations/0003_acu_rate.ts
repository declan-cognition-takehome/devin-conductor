export const name = '0003_acu_rate';

export const sql = `
-- Dollar value of one ACU. Devin pricing is contract specific, so the rate is left
-- unset until an operator supplies it and costs read as unknown until then.

ALTER TABLE settings ADD COLUMN acu_rate_usd REAL;
`;
