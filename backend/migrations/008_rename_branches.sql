-- Realign branch master data to current regional naming.

UPDATE branches SET name = 'Jalandhar HO' WHERE id = 'BR-HO';
UPDATE branches SET name = 'Patna Regional', state = 'Bihar', city = 'Patna' WHERE id = 'BR-DEL-003';
UPDATE branches SET name = 'Kolkata Regional', state = 'West Bengal', city = 'Kolkata' WHERE id = 'BR-JPR-004';
UPDATE branches SET name = 'Lucknow Regional' WHERE id = 'BR-LKO-005';

INSERT INTO branches (id, name, state, city, is_head_office) VALUES
 ('BR-RAN-006', 'Ranchi Branch',   'Jharkhand', 'Ranchi',   FALSE),
 ('BR-GHY-007', 'Guwahati Branch', 'Assam',     'Guwahati', FALSE)
ON CONFLICT (id) DO NOTHING;
