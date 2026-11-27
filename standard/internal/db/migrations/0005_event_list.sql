-- Lite's 0022_event_list: the event list (/admin/v1/events, the iOS app's feed) reads webhook_event
-- newest first. Every event is recorded from now on, whether or not a webhook endpoint wants it.
CREATE INDEX webhook_event_list ON webhook_event (environment, created_at, id COLLATE "C");
