-- 0004 — perbaiki baris security_reports yang extensions-nya tersimpan sebagai string JSON (double-encoded)
UPDATE security_reports SET extensions = (extensions #>> '{}')::jsonb WHERE jsonb_typeof(extensions) = 'string';
