-- The dashboard's customer list: newest customers first, and search by email.
-- Both keep a page of results to the rows it shows (D1's free plan counts rows read per day).
CREATE INDEX customer_first_seen ON customer (first_seen, id);
CREATE INDEX subscriber_attribute_value ON subscriber_attribute (key, value COLLATE NOCASE);
