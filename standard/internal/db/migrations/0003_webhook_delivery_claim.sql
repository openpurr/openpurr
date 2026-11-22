-- Standard only (Lite has no counterpart): a delivery attempt claims its row until claimed_until
-- (epoch ms) instead of holding a row lock while it waits for the endpoint, so slow endpoints
-- don't keep database connections busy. A claim left by a server that stopped mid-attempt
-- expires, and the retry job picks the delivery up again (internal/webhooks/delivery.go).
ALTER TABLE webhook_delivery ADD COLUMN claimed_until bigint;
