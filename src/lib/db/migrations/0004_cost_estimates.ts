export const name = '0004_cost_estimates';

export const sql = `
-- Self-serve accounts are billed in on-demand credits and the API reports no ACUs for them,
-- so sessions can be priced from their runtime instead. The rate defaults to Devin's
-- published on-demand price and estimation stays on unless an operator turns it off.

ALTER TABLE settings ADD COLUMN estimate_unmetered_costs INTEGER NOT NULL DEFAULT 1;

UPDATE settings SET acu_rate_usd = 2.25 WHERE acu_rate_usd IS NULL;
`;
