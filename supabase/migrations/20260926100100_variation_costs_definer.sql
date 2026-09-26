-- Variation costing (README R104), follow-up. The two validation triggers looked up the job, the machine, the rate
-- and the diary day under the caller's own read rights, so a PM writing a rate for a job they are not on was told
-- "That job is not this company's" instead of being refused by the rate card's policy (suite 45). They only check;
-- they now see every row they check. The policies still decide who may write.
alter function app.rate_items_before_write() security definer;
alter function app.variation_cost_lines_guard() security definer;
